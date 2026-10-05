import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { formatYen } from "@/lib/format";

// 発注書と受け取った請求書の突き合わせ。
// AIで読み取った(アップロード・AI受付箱の)請求書を、同じ取引先の発注書と比べる。
// ・検収前の発注書と金額がぴったり → この請求書で検収できる(請求書を取り込むと自動で検収もする)
// ・検収前の発注書と金額が違う → 差額を出す(数量・単価・送料などを確かめる)
// ・発注書の検収で作った請求書と、取り込んだ請求書が両方ある → 二重計上の疑い
// ・発注書を出している取引先なのに、合う発注書がない請求書 → 発注書なしの請求書

const DAY = 86_400_000;
const NEAR = 0.2; // 金額の差がこの割合までなら「同じ発注の請求書かも」として出す
const SINCE_DAYS = 180;

export type MatchKind = "MATCH" | "MISMATCH" | "DOUBLE" | "NO_PO";

type Inv = { id: string; invoiceNumber: string | null; vendorId: string | null; issueDate: Date | null; createdAt: Date; subtotalAmount: number; taxAmount: number; totalAmount: number; status: string };

const dateOf = (i: Inv) => jstDateKey(i.issueDate ?? i.createdAt);

export async function getPoMatches(companyId: string, now = new Date()) {
  const since = new Date(now.getTime() - SINCE_DAYS * DAY);
  const [invoices, orders] = await Promise.all([
    prisma.invoice.findMany({
      where: { companyId, direction: "RECEIVED", aiExtractionId: { not: null }, status: { notIn: ["CANCELLED"] }, purchaseOrder: null, createdAt: { gte: since } },
      include: { vendor: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.purchaseOrder.findMany({
      where: { companyId, OR: [{ status: "OPEN" }, { status: "RECEIVED", receivedDate: { gte: since } }] },
      include: { vendor: { select: { id: true, name: true } }, invoice: { select: { id: true, aiExtractionId: true, status: true, totalAmount: true } } },
      orderBy: { issueDate: "asc" },
    }),
  ]);
  const vendorsWithPo = new Set((await prisma.purchaseOrder.findMany({ where: { companyId }, select: { vendorId: true }, distinct: ["vendorId"] })).map((o) => o.vendorId));
  const rows: {
    kind: MatchKind;
    invoice: { id: string; number: string | null; date: string; total: number; subtotal: number; tax: number; status: string };
    vendor: string;
    order: { id: string; number: string; date: string; deliveryDate: string; total: number; subtotal: number; tax: number; status: string } | null;
    diff: number;
    message: string;
  }[] = [];
  const used = new Set<string>();
  for (const inv of invoices) {
    if (!inv.vendorId) continue;
    const mine = orders.filter((o) => o.vendorId === inv.vendorId && !used.has(o.id));
    const open = mine.filter((o) => o.status === "OPEN");
    const exact = open.find((o) => o.totalAmount === inv.totalAmount);
    const near = open
      .filter((o) => Math.abs(o.totalAmount - inv.totalAmount) <= o.totalAmount * NEAR)
      .sort((a, b) => Math.abs(a.totalAmount - inv.totalAmount) - Math.abs(b.totalAmount - inv.totalAmount))[0];
    // 発注書を検収して作った請求書(AIの読み取りではないもの)と、金額が近く日付も近い
    const double = mine.find(
      (o) =>
        o.status === "RECEIVED" &&
        o.invoice &&
        !o.invoice.aiExtractionId &&
        o.invoice.status !== "CANCELLED" &&
        Math.abs(o.totalAmount - inv.totalAmount) <= o.totalAmount * 0.05 &&
        o.receivedDate &&
        Math.abs(o.receivedDate.getTime() - (inv.issueDate ?? inv.createdAt).getTime()) <= 60 * DAY,
    );
    const invoice = { id: inv.id, number: inv.invoiceNumber, date: dateOf(inv), total: inv.totalAmount, subtotal: inv.subtotalAmount, tax: inv.taxAmount, status: inv.status };
    const po = (o: (typeof orders)[number]) => ({ id: o.id, number: o.orderNumber, date: jstDateKey(o.issueDate), deliveryDate: jstDateKey(o.deliveryDate), total: o.totalAmount, subtotal: o.subtotalAmount, tax: o.taxAmount, status: o.status });
    const vendor = inv.vendor?.name ?? "";
    const target = exact ?? near;
    if (target) {
      used.add(target.id);
      const diff = inv.totalAmount - target.totalAmount;
      const parts: string[] = [];
      if (target.subtotalAmount !== inv.subtotalAmount) parts.push(`税抜 ${formatYen(inv.subtotalAmount - target.subtotalAmount)}`);
      if (target.taxAmount !== inv.taxAmount) parts.push(`消費税 ${formatYen(inv.taxAmount - target.taxAmount)}`);
      rows.push({
        kind: diff === 0 ? "MATCH" : "MISMATCH",
        invoice,
        vendor,
        order: po(target),
        diff,
        message:
          diff === 0
            ? `発注書 ${target.orderNumber} と金額が合っています。この請求書で検収できます。`
            : `発注書 ${target.orderNumber} より ${diff > 0 ? "多い" : "少ない"}請求です(差 ${formatYen(Math.abs(diff))}${parts.length ? `:${parts.join("・")}` : ""})。数量・単価・送料・値引きを確かめてください。`,
      });
    } else if (double) {
      used.add(double.id);
      rows.push({
        kind: "DOUBLE",
        invoice,
        vendor,
        order: po(double),
        diff: inv.totalAmount - double.totalAmount,
        message: `発注書 ${double.orderNumber} はすでに検収して買掛金に計上しています。同じ請求を二重に計上していないか確かめてください。`,
      });
    } else if (vendorsWithPo.has(inv.vendorId)) {
      rows.push({ kind: "NO_PO", invoice, vendor, order: null, diff: 0, message: "発注書を出している取引先ですが、この請求書に合う発注書が見つかりません。発注書なしで頼んだものか確かめてください。" });
    }
  }
  const order: MatchKind[] = ["DOUBLE", "MISMATCH", "MATCH", "NO_PO"];
  rows.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  return rows;
}

export async function countPoIssues(companyId: string, now = new Date()) {
  return (await getPoMatches(companyId, now)).filter((r) => r.kind === "DOUBLE" || r.kind === "MISMATCH").length;
}

// 取り込んだ請求書で発注書を検収済みにする(請求書の仕訳はもうあるので、新しい仕訳は作らない)
export async function linkInvoiceToOrder(companyId: string, orderId: string, invoiceId: string) {
  return prisma.$transaction(async (tx) => {
    const [order, invoice] = await Promise.all([
      tx.purchaseOrder.findFirst({ where: { id: orderId, companyId } }),
      tx.invoice.findFirst({ where: { id: invoiceId, companyId, direction: "RECEIVED" }, include: { purchaseOrder: { select: { id: true } } } }),
    ]);
    if (!order || !invoice) throw new UserError("発注書か請求書が見つかりません");
    if (order.status !== "OPEN") throw new UserError("検収前の発注書だけに結び付けられます");
    if (invoice.status === "CANCELLED") throw new UserError("取り消した請求書です");
    if (invoice.purchaseOrder) throw new UserError("この請求書はほかの発注書に結び付いています");
    if (invoice.vendorId !== order.vendorId) throw new UserError("取引先が違います");
    const claimed = await tx.purchaseOrder.updateMany({ where: { id: orderId, companyId, status: "OPEN" }, data: { status: "RECEIVED", invoiceId: invoice.id, receivedDate: invoice.issueDate ?? new Date() } });
    if (claimed.count !== 1) throw new UserError("状態が変わりました。画面を更新してもう一度お試しください");
    return { order, invoice };
  });
}

// 二重に取り込んだ請求書を取り消す(仕訳も取消)。支払い済み・発注書に結び付いたものは取り消せない
export async function cancelImportedInvoice(companyId: string, invoiceId: string) {
  const invoice = await prisma.invoice.findFirst({ where: { id: invoiceId, companyId, direction: "RECEIVED", aiExtractionId: { not: null } }, include: { payments: { select: { id: true } }, purchaseOrder: { select: { id: true } } } });
  if (!invoice) throw new UserError("取り込んだ請求書が見つかりません");
  if (invoice.status === "CANCELLED") throw new UserError("すでに取り消しています");
  if (invoice.payments.length) throw new UserError("支払いを記録した請求書は取り消せません");
  if (invoice.purchaseOrder) throw new UserError("発注書に結び付いた請求書は取り消せません");
  await prisma.$transaction([
    prisma.invoice.update({ where: { id: invoice.id }, data: { status: "CANCELLED" } }),
    ...(invoice.journalEntryId ? [prisma.journalEntry.update({ where: { id: invoice.journalEntryId }, data: { status: "VOID" } })] : []),
  ]);
  return invoice;
}

// 請求書を取り込んだとき: 同じ取引先の検収前の発注書で、金額がぴったりのものが1つだけなら自動で検収する
export async function autoMatchImportedInvoice(companyId: string, invoiceId: string) {
  const invoice = await prisma.invoice.findFirst({ where: { id: invoiceId, companyId, direction: "RECEIVED" }, select: { id: true, vendorId: true, totalAmount: true } });
  if (!invoice?.vendorId) return null;
  const candidates = await prisma.purchaseOrder.findMany({ where: { companyId, vendorId: invoice.vendorId, status: "OPEN", totalAmount: invoice.totalAmount }, select: { id: true, orderNumber: true } });
  if (candidates.length !== 1) return null;
  try {
    await linkInvoiceToOrder(companyId, candidates[0].id, invoice.id);
    return candidates[0];
  } catch {
    return null;
  }
}

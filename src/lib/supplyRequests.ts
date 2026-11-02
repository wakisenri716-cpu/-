import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { MailError, appUrl, sendMail } from "@/lib/mail";
import { createPurchaseOrder } from "@/lib/accounting/purchaseOrders";

// 備品・消耗品の購入依頼: 従業員が「コピー用紙 A4 5箱 至急」のように1行で総務に頼み、
// 総務は同じ品物をまとめて、前に買った単価を目安に発注書を作る。届いたら依頼した人に知らせる。

type Me = { id: string; name: string; companyId: string; role: string };
const canManage = (role: string) => role === "ADMIN" || role === "ACCOUNTANT";
const UNITS = "箱|個|本|冊|枚|袋|パック|ケース|セット|台|束|巻|缶|ダース|つ|組|足|着|ロール|リットル|L|kg|キロ";
export const STATUS = { OPEN: "依頼中", ORDERED: "発注しました", DONE: "届きました", REJECTED: "見送り" } as const;

// 1行を分ける。「コピー用紙 A4 5箱 至急」→ 品物・数・単位・至急
export function parseSupplyText(text: string) {
  let t = String(text ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!t) throw new UserError("ほしいものを書いてください(例: コピー用紙 A4 5箱)");
  const urgent = /至急|急ぎ|すぐ|今日中|切れた|なくなった|無くなった/.test(t);
  t = t.replace(/至急|急ぎで?|すぐに?|今日中に?|(を|が)?(お願いします|ください|下さい|ほしい|欲しい|頼みます)|(が|を)?(切れた|なくなった|無くなった|切れそう|少ない)/g, " ");
  // 「ゴミ袋 45L 1パック」のように数+単位が2つあるときは、最後のもの(頼む数)を使う
  const qm = [...t.matchAll(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(${UNITS})(?![A-Za-z0-9])`, "g"))].pop() ?? t.match(/(\d+(?:\.\d+)?)\s*$/);
  const quantity = qm ? Number(qm[1]) : 1;
  const unit = qm?.[2] ?? null;
  const item = (qm ? t.replace(qm[0], " ") : t).replace(/\s+/g, " ").replace(/^[\s、。,]+|[\s、。,をが]+$/g, "").trim().slice(0, 60);
  if (!item) throw new UserError("品物の名前を書いてください");
  return { item, quantity: quantity > 0 && quantity <= 10000 ? quantity : 1, unit, urgent };
}

export async function requestSupply(me: Me, raw: Record<string, unknown>, request?: Request) {
  const p = raw.text ? parseSupplyText(String(raw.text)) : { item: String(raw.item ?? "").trim().slice(0, 60), quantity: Number(raw.quantity) || 1, unit: raw.unit ? String(raw.unit).slice(0, 10) : null, urgent: raw.urgent === true };
  if (!p.item) throw new UserError("品物の名前を書いてください");
  if ((await prisma.supplyRequest.count({ where: { companyId: me.companyId, userId: me.id, status: "OPEN" } })) >= 30) throw new UserError("依頼中のものが多すぎます。届いてから頼んでください");
  const r = await prisma.supplyRequest.create({ data: { companyId: me.companyId, userId: me.id, userName: me.name, item: p.item, quantity: p.quantity, unit: p.unit, urgent: p.urgent, note: String(raw.note ?? "").trim().slice(0, 200) || null } });
  // 至急のものは管理者にメールで知らせる
  if (r.urgent) {
    const admins = await prisma.companyMember.findMany({ where: { companyId: me.companyId, active: true, role: { in: ["ADMIN", "ACCOUNTANT"] }, userId: { not: me.id } }, include: { user: { select: { email: true, name: true, active: true } } } });
    for (const a of admins) {
      if (!a.user.active || !a.user.email) continue;
      try {
        await sendMail({ companyId: me.companyId, kind: "NOTICE", to: a.user.email, subject: `【至急の購入依頼】${r.item} ${r.quantity}${r.unit ?? ""}`, text: `${a.user.name}さん\n\n${me.name}さんから至急の購入依頼です。\n\n${r.item} ${r.quantity}${r.unit ?? ""}${r.note ? `\n${r.note}` : ""}\n\n購入依頼: ${appUrl(request)}/supplies\n`, sentByName: me.name, relatedId: r.id });
      } catch (error) {
        if (!(error instanceof MailError)) throw error;
        break;
      }
    }
  }
  return r;
}

export async function mySupplyRequests(me: { id: string; companyId: string }) {
  return prisma.supplyRequest.findMany({ where: { companyId: me.companyId, userId: me.id }, orderBy: { createdAt: "desc" }, take: 30 });
}

const key = (item: string, unit: string | null) => `${item.replace(/\s/g, "").toLowerCase()}|${unit ?? ""}`;

// 総務の画面: 依頼中を同じ品物でまとめ、前に買った単価と発注先を目安に出す。発注済み・最近届いたものも
export async function listSupplyRequests(companyId: string) {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const rows = await prisma.supplyRequest.findMany({ where: { companyId, OR: [{ status: { in: ["OPEN", "ORDERED"] } }, { updatedAt: { gte: since } }] }, orderBy: { createdAt: "asc" }, take: 500 });
  const open = rows.filter((r) => r.status === "OPEN");
  const groups = new Map<string, { key: string; item: string; unit: string | null; quantity: number; urgent: boolean; requests: typeof open }>();
  for (const r of open) {
    const k = key(r.item, r.unit);
    const g = groups.get(k) ?? { key: k, item: r.item, unit: r.unit, quantity: 0, urgent: false, requests: [] };
    g.quantity += r.quantity;
    g.urgent ||= r.urgent;
    g.requests.push(r);
    groups.set(k, g);
  }
  // 前に買った単価・発注先(発注書の明細から、品物の名前が同じか含むもの)
  const lines = groups.size ? await prisma.purchaseOrderLine.findMany({ where: { purchaseOrder: { companyId } }, include: { purchaseOrder: { select: { issueDate: true, vendor: { select: { name: true } } } } }, orderBy: { purchaseOrder: { issueDate: "desc" } }, take: 500 }) : [];
  const last = (item: string) => {
    const k = item.replace(/\s/g, "").toLowerCase();
    const l = lines.find((x) => {
      const d = x.description.replace(/\s/g, "").toLowerCase();
      return d === k || d.includes(k) || (k.length >= 3 && k.includes(d));
    });
    return l ? { unitPrice: l.unitPrice, taxRate: l.taxRate, vendor: l.purchaseOrder.vendor.name, date: jstDateKey(l.purchaseOrder.issueDate) } : null;
  };
  return {
    groups: [...groups.values()].sort((a, b) => Number(b.urgent) - Number(a.urgent)).map((g) => ({ ...g, last: last(g.item) })),
    others: rows.filter((r) => r.status !== "OPEN").reverse(),
  };
}

// まとめて発注書を作る: { vendorName, deliveryDate, items: [{ requestIds, description, quantity, unit, unitPrice, taxRate }] }
export async function orderSupplies(me: Me, raw: Record<string, unknown>) {
  if (!canManage(me.role)) throw new UserError("発注は管理者・経理担当ができます");
  const items = (Array.isArray(raw.items) ? raw.items : []).slice(0, 50) as Record<string, unknown>[];
  if (!items.length) throw new UserError("発注する品物を選んでください");
  const ids = items.flatMap((i) => (Array.isArray(i.requestIds) ? i.requestIds.map(String) : []));
  const reqs = await prisma.supplyRequest.findMany({ where: { companyId: me.companyId, id: { in: ids }, status: "OPEN" } });
  if (reqs.length !== new Set(ids).size) throw new UserError("ほかの人が先に発注したか、見送った依頼があります。画面を読み直してください");
  const today = jstDateKey(new Date());
  const order = await createPurchaseOrder(me.companyId, {
    vendorName: String(raw.vendorName ?? ""),
    issueDate: today,
    deliveryDate: String(raw.deliveryDate ?? "") || today,
    deliveryPlace: null,
    paymentTerms: null,
    notes: `社内の購入依頼(${[...new Set(reqs.map((r) => r.userName))].join("・")})から作成`,
    lines: items.map((i) => ({ description: String(i.description ?? "").slice(0, 200), quantity: Number(i.quantity), unit: i.unit ? String(i.unit) : null, unitPrice: Number(i.unitPrice), taxRate: Number(i.taxRate ?? 10) })),
  });
  await prisma.supplyRequest.updateMany({ where: { id: { in: ids } }, data: { status: "ORDERED", purchaseOrderId: order.id, handledByName: me.name } });
  return { order: { id: order.id, orderNumber: order.orderNumber, totalAmount: order.totalAmount }, count: ids.length };
}

// 届いた・見送り。依頼した人にメールで知らせる
export async function updateSupplyRequest(me: Me, id: string, raw: Record<string, unknown>, request?: Request) {
  if (!canManage(me.role)) throw new UserError("管理者・経理担当が扱えます");
  const r = await prisma.supplyRequest.findFirst({ where: { id, companyId: me.companyId } });
  if (!r) throw new UserError("見つかりません");
  const status = raw.status === "DONE" ? "DONE" : raw.status === "REJECTED" ? "REJECTED" : null;
  if (!status) throw new UserError("変更の内容がありません");
  const reply = String(raw.reply ?? "").trim().slice(0, 200) || null;
  if (status === "REJECTED" && !reply) throw new UserError("見送る理由を書いてください");
  const updated = await prisma.supplyRequest.update({ where: { id }, data: { status, reply, handledByName: me.name } });
  const user = await prisma.user.findFirst({ where: { id: r.userId, active: true }, select: { email: true } });
  if (user?.email && r.userId !== me.id) {
    try {
      await sendMail({ companyId: me.companyId, kind: "NOTICE", to: user.email, subject: status === "DONE" ? `【購入依頼】${r.item}が届きました` : `【購入依頼】${r.item}は見送りになりました`, text: `${r.userName}さん\n\n依頼した「${r.item} ${r.quantity}${r.unit ?? ""}」は${status === "DONE" ? "届きました" : `見送りになりました(${reply})`}。\n\n購入依頼: ${appUrl(request)}/staff/supplies\n`, sentByName: me.name, relatedId: r.id });
    } catch (error) {
      if (!(error instanceof MailError)) throw error;
    }
  }
  return updated;
}

export async function countOpenSupplyRequests(companyId: string) {
  const [count, urgent] = await Promise.all([prisma.supplyRequest.count({ where: { companyId, status: "OPEN" } }), prisma.supplyRequest.count({ where: { companyId, status: "OPEN", urgent: true } })]);
  return { count, urgent };
}

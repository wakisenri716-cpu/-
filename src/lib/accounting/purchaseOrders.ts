import { prisma } from "@/lib/prisma";
import { toBooksClosedError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { ensureAccount } from "./accounts";
import { CHART_OF_ACCOUNTS, EXPENSE_ACCOUNT_CODES } from "./chartOfAccounts";
import { findOrCreateVendor } from "./parties";
import { resolveProjectId } from "./projects";
import { calcInvoice, InvoiceError, validDate, validateLines, type InvoiceLineInput } from "./issueInvoice";

// 発注書: 仕入先・外注先への注文。発注しただけでは仕訳を作らず、
// 納品を受けて「検収」したときに、受け取った請求書(買掛金)として計上する。

export type PurchaseOrderInput = {
  vendorName: string;
  issueDate: string;
  deliveryDate: string;
  deliveryPlace?: string | null;
  paymentTerms?: string | null;
  lines: InvoiceLineInput[];
  notes?: string | null;
};

// 検収のときに選べる科目(仕入は売上原価、ほかは経費の科目)
export const RECEIVE_ACCOUNT_CODES = ["5000", ...EXPENSE_ACCOUNT_CODES];
export const RECEIVE_ACCOUNTS = RECEIVE_ACCOUNT_CODES.map((code) => ({ code, name: CHART_OF_ACCOUNTS.find((a) => a.code === code)?.name ?? code }));

function text(value: string | null | undefined, max: number, label: string) {
  const v = value?.trim() || null;
  if (v && v.length > max) throw new InvoiceError(`${label}は${max}文字以内で入力してください`);
  return v;
}

async function nextOrderNumber(companyId: string, issueDate: string) {
  const prefix = `PO-${issueDate.slice(0, 4)}${issueDate.slice(5, 7)}-`;
  const last = await prisma.purchaseOrder.findFirst({
    where: { companyId, orderNumber: { startsWith: prefix } },
    orderBy: { orderNumber: "desc" },
    select: { orderNumber: true },
  });
  const seq = last ? Number(last.orderNumber.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(seq).padStart(3, "0")}`;
}

export async function createPurchaseOrder(companyId: string, input: PurchaseOrderInput) {
  if (!input.vendorName.trim()) throw new InvoiceError("発注先を入力してください");
  if (!validDate(input.issueDate)) throw new InvoiceError("発注日を正しく入力してください");
  if (!validDate(input.deliveryDate)) throw new InvoiceError("納期を正しく入力してください");
  if (input.deliveryDate < input.issueDate) throw new InvoiceError("納期は発注日以降にしてください");
  const deliveryPlace = text(input.deliveryPlace, 100, "納品場所");
  const paymentTerms = text(input.paymentTerms, 100, "支払条件");
  const notes = text(input.notes, 1000, "備考");
  const calc = calcInvoice(validateLines(input.lines));
  if (calc.total <= 0) throw new InvoiceError("合計金額が0円の発注書は作成できません");
  const vendor = await findOrCreateVendor(companyId, input.vendorName.trim());

  // 同時に作成されて番号が重複した場合は、一意制約のエラーを受けて採番し直す
  for (let attempt = 0; attempt < 3; attempt++) {
    const orderNumber = await nextOrderNumber(companyId, input.issueDate);
    try {
      return await prisma.purchaseOrder.create({
        data: {
          companyId,
          orderNumber,
          vendorId: vendor.id,
          issueDate: new Date(`${input.issueDate}T00:00:00Z`),
          deliveryDate: new Date(`${input.deliveryDate}T00:00:00Z`),
          deliveryPlace,
          paymentTerms,
          subtotalAmount: calc.subtotal,
          taxAmount: calc.tax,
          totalAmount: calc.total,
          notes,
          lines: {
            create: calc.lines.map((l, i) => ({
              sortOrder: i,
              description: l.description.trim(),
              quantity: l.quantity,
              unit: l.unit?.trim() || null,
              unitPrice: l.unitPrice,
              taxRate: l.taxRate,
              amount: l.amount,
            })),
          },
        },
      });
    } catch (error) {
      if ((error as { code?: string }).code !== "P2002") throw error;
    }
  }
  throw new InvoiceError("発注番号の採番に失敗しました。もう一度お試しください");
}

export async function listPurchaseOrders(companyId: string) {
  return prisma.purchaseOrder.findMany({
    where: { companyId },
    include: { vendor: { select: { id: true, name: true } }, invoice: { select: { id: true, status: true } } },
    orderBy: [{ issueDate: "desc" }, { orderNumber: "desc" }],
  });
}

export async function getPurchaseOrder(companyId: string, id: string) {
  const order = await prisma.purchaseOrder.findFirst({
    where: { id, companyId },
    include: {
      lines: { orderBy: { sortOrder: "asc" } },
      vendor: { include: { defaultExpenseAccount: { select: { code: true } } } },
      company: true,
      invoice: { select: { id: true, invoiceNumber: true, dueDate: true, status: true, journalEntryId: true, payments: { select: { amount: true } } } },
    },
  });
  if (!order) return null;
  const vendorCode = order.vendor.defaultExpenseAccount?.code;
  return { order, calc: calcInvoice(order.lines), defaultAccountCode: vendorCode && RECEIVE_ACCOUNT_CODES.includes(vendorCode) ? vendorCode : "5000" };
}

// 納期を過ぎても検収していない発注
export function countLateOrders(companyId: string, now = new Date()) {
  return prisma.purchaseOrder.count({ where: { companyId, status: "OPEN", deliveryDate: { lt: new Date(`${jstDateKey(now)}T00:00:00Z`) } } });
}

// 検収: 受け取った請求書(買掛金)を作り、「科目・仮払消費税 / 買掛金」の仕訳を記帳する。
// 以後は買掛金・支払・振込データで、ほかの受け取った請求書と同じように扱える。
export async function receivePurchaseOrder(
  companyId: string,
  id: string,
  input: { receivedDate: string; dueDate: string; accountCode: string; vendorInvoiceNumber?: string | null; projectId?: string | null },
) {
  if (!validDate(input.receivedDate)) throw new InvoiceError("検収日を正しく入力してください");
  if (!validDate(input.dueDate)) throw new InvoiceError("支払期日を正しく入力してください");
  if (input.dueDate < input.receivedDate) throw new InvoiceError("支払期日は検収日以降にしてください");
  if (!RECEIVE_ACCOUNT_CODES.includes(input.accountCode)) throw new InvoiceError("勘定科目を選んでください");
  const vendorInvoiceNumber = text(input.vendorInvoiceNumber, 50, "請求書番号");
  const projectId = await resolveProjectId(companyId, input.projectId);
  const data = await getPurchaseOrder(companyId, id);
  if (!data) throw new InvoiceError("発注書が見つかりません");
  const { order } = data;
  if (order.status === "RECEIVED") throw new InvoiceError("この発注書はすでに検収しています");
  if (order.status === "CANCELLED") throw new InvoiceError("取り消した発注書は検収できません");

  try {
    return await prisma.$transaction(async (tx) => {
      // 2回押されても請求書が2枚できないよう、先に「検収済み」を確保してから作る
      const claimed = await tx.purchaseOrder.updateMany({ where: { id, companyId, status: "OPEN" }, data: { status: "RECEIVED" } });
      if (claimed.count !== 1) throw new InvoiceError("状態が変わりました。画面を更新してもう一度お試しください");
      const [expense, inputTax, payable] = await Promise.all([
        ensureAccount(tx, companyId, input.accountCode),
        ensureAccount(tx, companyId, "1220"),
        ensureAccount(tx, companyId, "2010"),
      ]);
      const date = new Date(`${input.receivedDate}T00:00:00Z`);
      const entry = await tx.journalEntry.create({
        data: {
          companyId,
          date,
          description: `発注書の検収: ${order.orderNumber} ${order.vendor.name}`,
          projectId,
          sourceType: "INVOICE",
          status: "AUTO_POSTED",
          createdByAi: false,
          lines: {
            create: [
              { accountId: expense.id, debit: order.subtotalAmount, credit: 0, memo: "仕入・経費計上" },
              ...(order.taxAmount > 0 ? [{ accountId: inputTax.id, debit: order.taxAmount, credit: 0, memo: "仮払消費税" }] : []),
              { accountId: payable.id, debit: 0, credit: order.totalAmount, memo: "買掛金計上" },
            ],
          },
        },
      });
      const invoice = await tx.invoice.create({
        data: {
          companyId,
          direction: "RECEIVED",
          status: "CONFIRMED",
          invoiceNumber: vendorInvoiceNumber ?? order.orderNumber,
          vendorId: order.vendorId,
          issueDate: date,
          dueDate: new Date(`${input.dueDate}T00:00:00Z`),
          subtotalAmount: order.subtotalAmount,
          taxAmount: order.taxAmount,
          totalAmount: order.totalAmount,
          notes: `発注書 ${order.orderNumber} を検収して計上`,
          journalEntryId: entry.id,
        },
      });
      await tx.purchaseOrder.update({ where: { id }, data: { invoiceId: invoice.id, receivedDate: date } });
      return { order, invoice };
    });
  } catch (error) {
    throw toBooksClosedError(error) ?? error;
  }
}

// 検収の取消: 支払っていなければ、計上した請求書を取り消し(仕訳も取消)、発注済みに戻す
export async function undoReceive(companyId: string, id: string) {
  const data = await getPurchaseOrder(companyId, id);
  if (!data) throw new InvoiceError("発注書が見つかりません");
  const { order } = data;
  if (order.status !== "RECEIVED" || !order.invoice) throw new InvoiceError("検収していない発注書です");
  const invoice = order.invoice;
  try {
    await prisma.$transaction(async (tx) => {
      const reopened = await tx.purchaseOrder.updateMany({ where: { id, companyId, status: "RECEIVED" }, data: { status: "OPEN", invoiceId: null, receivedDate: null } });
      if (reopened.count !== 1) throw new InvoiceError("状態が変わりました。画面を更新してもう一度お試しください");
      if (await tx.payment.count({ where: { invoiceId: invoice.id } })) throw new InvoiceError("支払を記録した後は検収を取り消せません。先に支払の記録を取り消してください");
      await tx.invoice.update({ where: { id: invoice.id }, data: { status: "CANCELLED" } });
      if (invoice.journalEntryId) await tx.journalEntry.update({ where: { id: invoice.journalEntryId }, data: { status: "VOID" } });
    });
  } catch (error) {
    throw toBooksClosedError(error) ?? error;
  }
  return order;
}

export async function cancelPurchaseOrder(companyId: string, id: string) {
  const updated = await prisma.purchaseOrder.updateMany({ where: { id, companyId, status: "OPEN" }, data: { status: "CANCELLED" } });
  if (updated.count !== 1) throw new InvoiceError("検収した発注書・取り消した発注書は取り消せません");
}

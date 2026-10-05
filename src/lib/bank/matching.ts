import { prisma } from "@/lib/prisma";
import type { BankTransaction, Prisma } from "@prisma/client";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { ensureAccount } from "@/lib/accounting/accounts";
import { getBankAccount } from "./accounts";
import { normalizeText } from "./rules";

// 銀行明細と請求書の消込(手動・まとめて)。
// ・1回の入金で複数の請求書をまとめて消込む
// ・先方が振込手数料を差し引いて入金したときは、差額を支払手数料にする
// ・入金を消込んだら、摘要を顧客の「振込名義」として覚え、次からの候補と自動消込に使う

export const SETTLEABLE_INVOICE_STATUSES = ["CONFIRMED", "SENT", "PARTIALLY_PAID", "OVERDUE"] as const;
export const MAX_FEE = 1_000; // 先方負担の振込手数料とみなす差額の上限
const FEE_ACCOUNT = "5080"; // 支払手数料

// 摘要から振込名義を取り出す(「振込」「フリコミ」などの前置きと空白を除く)
export function payerKey(description: string) {
  return normalizeText(description)
    .replace(/^(振込|振替|フリコミ|フリカエ|ﾌﾘｺﾐ)\s*/, "")
    .replace(/\s+/g, "")
    .slice(0, 60);
}

type OpenInvoice = {
  id: string;
  invoiceNumber: string | null;
  party: string;
  partyId: string | null;
  issueDate: string | null;
  dueDate: string | null;
  totalAmount: number;
  remaining: number;
  payerMatch: boolean;
};

async function openInvoices(companyId: string, direction: "ISSUED" | "RECEIVED", description: string): Promise<OpenInvoice[]> {
  const invoices = await prisma.invoice.findMany({
    where: { companyId, direction, status: { in: [...SETTLEABLE_INVOICE_STATUSES] } },
    include: { payments: { select: { amount: true } }, customer: { select: { id: true, name: true, payerName: true } }, vendor: { select: { id: true, name: true } } },
    orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
  });
  const key = payerKey(description);
  return invoices
    .map((inv) => {
      const remaining = inv.totalAmount - inv.payments.reduce((s, p) => s + p.amount, 0);
      const party = inv.customer ?? inv.vendor;
      const payer = inv.customer?.payerName ?? null;
      return {
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        party: party?.name ?? "(取引先なし)",
        partyId: party?.id ?? null,
        issueDate: inv.issueDate ? jstDateKey(inv.issueDate) : null,
        dueDate: inv.dueDate ? jstDateKey(inv.dueDate) : null,
        totalAmount: inv.totalAmount,
        remaining,
        payerMatch: !!payer && !!key && (key.includes(payer) || payer.includes(key)),
      };
    })
    .filter((i) => i.remaining > 0);
}

type Proposal = { invoiceIds: string[]; fee: number; label: string };

// 消込の候補: 金額が合う請求書(1件・振込手数料を引かれた1件・同じ取引先の何件か)
function proposals(invoices: OpenInvoice[], amount: number, deposit: boolean): Proposal[] {
  const out: Proposal[] = [];
  const seen = new Set<string>();
  const push = (list: OpenInvoice[], fee: number, label: string) => {
    const k = list.map((i) => i.id).sort().join(",");
    if (seen.has(k) || out.length >= 6) return;
    seen.add(k);
    out.push({ invoiceIds: list.map((i) => i.id), fee, label });
  };
  const ordered = [...invoices].sort((a, b) => Number(b.payerMatch) - Number(a.payerMatch));
  for (const inv of ordered) if (inv.remaining === amount) push([inv], 0, `${inv.party} ${inv.invoiceNumber ?? ""} と金額が一致`);
  if (deposit) {
    for (const inv of ordered) {
      const fee = inv.remaining - amount;
      if (fee > 0 && fee <= MAX_FEE) push([inv], fee, `${inv.party} ${inv.invoiceNumber ?? ""}(振込手数料 ${fee.toLocaleString()}円を引かれた入金)`);
    }
  }
  // 同じ取引先の請求書を期日の古い順に足して、合計が合うところまで
  const byParty = new Map<string, OpenInvoice[]>();
  for (const inv of ordered) if (inv.partyId) byParty.set(inv.partyId, [...(byParty.get(inv.partyId) ?? []), inv]);
  for (const list of byParty.values()) {
    if (list.length < 2) continue;
    let sum = 0;
    for (let i = 0; i < list.length; i++) {
      sum += list[i].remaining;
      if (i === 0) continue;
      const fee = sum - amount;
      if (fee === 0 || (deposit && fee > 0 && fee <= MAX_FEE)) push(list.slice(0, i + 1), fee, `${list[0].party} の請求書${i + 1}件の合計${fee ? `(振込手数料 ${fee.toLocaleString()}円を引かれた入金)` : "と一致"}`);
      if (sum > amount + MAX_FEE) break;
    }
  }
  return out;
}

async function pendingRow(companyId: string, id: string) {
  const row = await prisma.bankTransaction.findFirst({ where: { id, companyId } });
  if (!row) throw new UserError("明細が見つかりません");
  if (row.status !== "PENDING") throw new UserError("この明細はすでに処理されています");
  const bank = await getBankAccount(companyId, row.bankAccountId);
  if (bank.kind === "CARD") throw new UserError("カードの明細は請求書と消込めません");
  return { row, bank };
}

export async function getMatchCandidates(companyId: string, id: string) {
  const { row, bank } = await pendingRow(companyId, id);
  const deposit = row.deposit > 0;
  const amount = deposit ? row.deposit : row.withdrawal;
  const invoices = await openInvoices(companyId, deposit ? "ISSUED" : "RECEIVED", row.description);
  invoices.sort((a, b) => Number(b.payerMatch) - Number(a.payerMatch));
  return {
    row: { id: row.id, date: jstDateKey(row.date), description: row.description, amount, deposit, bankName: bank.name },
    invoices,
    proposals: proposals(invoices, amount, deposit),
    maxFee: MAX_FEE,
  };
}

// 選んだ請求書に、明細の金額(入金なら + 差し引かれた振込手数料)を期日の古い順に充てる。最後の1件だけは一部の入金でもよい
async function settle(tx: Prisma.TransactionClient, row: BankTransaction, ownCode: string, ownName: string, invoiceIds: string[], fee: number, auto: boolean) {
  const deposit = row.deposit > 0;
  const amount = deposit ? row.deposit : row.withdrawal;
  const invoices = await tx.invoice.findMany({
    where: { id: { in: invoiceIds }, companyId: row.companyId, direction: deposit ? "ISSUED" : "RECEIVED", status: { in: [...SETTLEABLE_INVOICE_STATUSES] } },
    include: { payments: { select: { amount: true } }, customer: { select: { id: true, payerName: true } } },
    orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
  });
  if (invoices.length !== invoiceIds.length) throw new UserError("消込めない請求書が含まれています(取消・支払済みなど)");
  let left = amount + fee;
  const applied = invoices.map((inv, i) => {
    const remaining = inv.totalAmount - inv.payments.reduce((s, p) => s + p.amount, 0);
    const take = i === invoices.length - 1 ? Math.min(left, remaining) : remaining;
    left -= take;
    return { inv, remaining, take };
  });
  if (applied.some((a) => a.take <= 0) || left < 0) throw new UserError("入金額が足りません。請求書の選び方を確かめてください");
  if (left > 0) throw new UserError(`選んだ請求書の残りより ${left.toLocaleString()}円 多い${deposit ? "入金" : "支払"}です`);

  const [bank, counter, feeAcc] = await Promise.all([
    ensureAccount(tx, row.companyId, ownCode),
    ensureAccount(tx, row.companyId, deposit ? "1110" : "2010"),
    ensureAccount(tx, row.companyId, FEE_ACCOUNT),
  ]);
  const label = (inv: (typeof invoices)[number]) => inv.invoiceNumber ?? inv.id.slice(-6);
  const lines = deposit
    ? [
        { accountId: bank.id, debit: amount, credit: 0, memo: `${ownName} 入金` },
        ...(fee > 0 ? [{ accountId: feeAcc.id, debit: fee, credit: 0, memo: "振込手数料(先方負担で差し引き)" }] : []),
        ...applied.map((a) => ({ accountId: counter.id, debit: 0, credit: a.take, memo: `売掛金消込 ${label(a.inv)}` })),
      ]
    : [
        ...applied.map((a) => ({ accountId: counter.id, debit: a.take, credit: 0, memo: `買掛金消込 ${label(a.inv)}` })),
        { accountId: bank.id, debit: 0, credit: amount, memo: `${ownName} 支払` },
      ];
  const entry = await tx.journalEntry.create({
    data: {
      companyId: row.companyId,
      date: row.date,
      description: `${deposit ? "入金消込" : "支払消込"}: ${applied.map((a) => label(a.inv)).join("・")}(${row.description})`.slice(0, 300),
      sourceType: "PAYMENT",
      status: auto ? "AUTO_POSTED" : "POSTED_MANUALLY",
      lines: { create: lines },
    },
  });
  // 入金記録は請求書ごと。仕訳は1つなので、仕訳とのひも付けは最初の1件だけに付ける
  for (const [i, a] of applied.entries()) {
    await tx.payment.create({ data: { companyId: row.companyId, invoiceId: a.inv.id, amount: a.take, paymentDate: row.date, journalEntryId: i === 0 ? entry.id : null } });
    await tx.invoice.update({ where: { id: a.inv.id }, data: { status: a.take >= a.remaining ? "PAID" : "PARTIALLY_PAID" } });
  }
  const updated = await tx.bankTransaction.updateMany({
    where: { id: row.id, status: "PENDING", journalEntryId: null },
    data: {
      status: "MATCHED",
      matchedInvoiceId: applied[0].inv.id,
      journalEntryId: entry.id,
      confidence: auto ? 1 : null,
      suggestionSource: "INVOICE",
      suggestionReason: `${auto ? "振込名義と請求書の合計が一致して自動消込" : "請求書と消込"}(${applied.length}件${fee ? `・振込手数料 ${fee.toLocaleString()}円` : ""})`,
    },
  });
  if (updated.count !== 1) throw new UserError("この明細はすでに処理されています");
  // 入金の振込名義を顧客に覚える(1社の請求書だけを消込んだとき)
  const customers = new Set(applied.map((a) => a.inv.customer?.id).filter(Boolean));
  if (deposit && customers.size === 1) {
    const key = payerKey(row.description);
    if (key) await tx.customer.update({ where: { id: [...customers][0]! }, data: { payerName: key } });
  }
  return { entryId: entry.id, invoices: applied.length, applied: applied.reduce((s, a) => s + a.take, 0), fee };
}

export async function settleBankRow(companyId: string, id: string, input: { invoiceIds?: unknown; fee?: unknown }) {
  const { row, bank } = await pendingRow(companyId, id);
  const ids = Array.isArray(input.invoiceIds) ? [...new Set(input.invoiceIds.map(String))] : [];
  if (ids.length === 0) throw new UserError("消込む請求書を選んでください");
  if (ids.length > 50) throw new UserError("一度に消込めるのは50件までです");
  const fee = Number(input.fee ?? 0);
  if (!Number.isInteger(fee) || fee < 0 || fee > MAX_FEE) throw new UserError(`振込手数料は0〜${MAX_FEE.toLocaleString()}円で入力してください`);
  if (fee > 0 && row.deposit <= 0) throw new UserError("振込手数料の差し引きは入金のときだけ使えます");
  return prisma.$transaction((tx) => settle(tx, row, bank.account.code, bank.name, ids, fee, false));
}

// 取り込みのとき: 摘要が覚えた振込名義の顧客1社に当たり、その顧客の請求書の残りの合計(期日の古い順)と入金がちょうど合えば自動で消込む
export async function autoSettleByPayer(row: BankTransaction, ownCode: string, ownName: string) {
  if (row.deposit <= 0) return null;
  const invoices = (await openInvoices(row.companyId, "ISSUED", row.description)).filter((i) => i.payerMatch);
  const parties = new Set(invoices.map((i) => i.partyId));
  if (invoices.length < 1 || parties.size !== 1) return null;
  let sum = 0;
  for (let i = 0; i < invoices.length; i++) {
    sum += invoices[i].remaining;
    if (sum === row.deposit) {
      const ids = invoices.slice(0, i + 1).map((x) => x.id);
      return prisma.$transaction((tx) => settle(tx, row, ownCode, ownName, ids, 0, true));
    }
    if (sum > row.deposit) break;
  }
  return null;
}

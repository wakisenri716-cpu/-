import { prisma } from "@/lib/prisma";
import { jstDateKey } from "@/lib/jst";
import { ensureAccount } from "./accounts";
import { UserError } from "@/lib/errors";

export class ReimbursementError extends UserError {}

const POSTED = new Set(["AUTO_POSTED", "POSTED_MANUALLY"]);
const PAYABLE_ACCOUNT = "2020"; // 未払金(経費の仕訳で「従業員立替分」として計上している)
const PAY_FROM = { "1010": "現金", "1020": "普通預金" } as const;
export type PayFrom = keyof typeof PAY_FROM;

// 経費精算ごとの精算状況。記帳済みの明細の合計が本人に払う金額。
// レビュー待ちの明細が残っていると金額が確定しないので、精算できない。
export async function getReimbursements(companyId: string) {
  const reports = await prisma.expenseReport.findMany({
    where: { companyId, items: { some: {} } },
    include: {
      employee: { select: { id: true, name: true } },
      items: { select: { amount: true, journalEntry: { select: { status: true } } } },
      reimbursementEntry: { select: { date: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return reports.map((r) => {
    const posted = r.items.filter((i) => i.journalEntry && POSTED.has(i.journalEntry.status));
    const pending = r.items.filter((i) => i.journalEntry?.status === "PENDING_REVIEW").length;
    const amount = posted.reduce((s, i) => s + i.amount, 0);
    const state = r.reimbursedAt ? "PAID" : pending > 0 ? "REVIEWING" : amount > 0 ? "READY" : "NOTHING";
    return {
      id: r.id,
      employee: r.employee,
      createdAt: r.createdAt,
      itemCount: r.items.length,
      pending,
      amount,
      state,
      reimbursedOn: r.reimbursementEntry ? r.reimbursementEntry.date.toISOString().slice(0, 10) : null,
    } as const;
  });
}

export async function reimburse(companyId: string, reportId: string, input: { date?: string; payFrom?: string }) {
  const date = input.date || jstDateKey(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) throw new ReimbursementError("支払日を正しく入力してください");
  const payFrom = (input.payFrom ?? "1020") as PayFrom;
  if (!(payFrom in PAY_FROM)) throw new ReimbursementError("支払方法を選んでください");

  const report = (await getReimbursements(companyId)).find((r) => r.id === reportId);
  if (!report) throw new ReimbursementError("経費精算が見つかりません");
  if (report.state === "PAID") throw new ReimbursementError("この経費精算はすでに精算済みです");
  if (report.state === "REVIEWING") throw new ReimbursementError("レビュー待ちの明細があります。先にレビューキューで確定してください");
  if (report.state === "NOTHING") throw new ReimbursementError("精算する金額がありません");

  return prisma.$transaction(async (tx) => {
    // 2回押されても二重に支払仕訳ができないよう、未精算であることを条件に先に確保する
    const claimed = await tx.expenseReport.updateMany({ where: { id: reportId, companyId, reimbursedAt: null }, data: { reimbursedAt: new Date() } });
    if (claimed.count !== 1) throw new ReimbursementError("この経費精算はすでに精算済みです");
    const [payable, cash] = await Promise.all([ensureAccount(tx, companyId, PAYABLE_ACCOUNT), ensureAccount(tx, companyId, payFrom)]);
    const entry = await tx.journalEntry.create({
      data: {
        companyId,
        date: new Date(`${date}T00:00:00Z`),
        description: `立替経費の精算: ${report.employee.name}さん`,
        sourceType: "REIMBURSEMENT",
        status: "POSTED_MANUALLY",
        lines: {
          create: [
            { accountId: payable.id, debit: report.amount, credit: 0, memo: "従業員立替分の支払" },
            { accountId: cash.id, debit: 0, credit: report.amount, memo: PAY_FROM[payFrom] },
          ],
        },
      },
    });
    return tx.expenseReport.update({ where: { id: reportId }, data: { reimbursementEntryId: entry.id } });
  });
}

// 精算の取消(振込を間違えた場合など)。支払の仕訳を無効にして未精算に戻す。
export async function undoReimbursement(companyId: string, reportId: string) {
  const report = await prisma.expenseReport.findFirst({ where: { id: reportId, companyId } });
  if (!report?.reimbursedAt) throw new ReimbursementError("精算済みの経費精算ではありません");
  return prisma.$transaction(async (tx) => {
    const released = await tx.expenseReport.updateMany({
      where: { id: reportId, companyId, reimbursementEntryId: report.reimbursementEntryId },
      data: { reimbursedAt: null, reimbursementEntryId: null },
    });
    if (released.count !== 1) throw new ReimbursementError("状態が変わりました。画面を更新してもう一度お試しください");
    if (report.reimbursementEntryId) {
      await tx.journalEntry.update({ where: { id: report.reimbursementEntryId }, data: { status: "VOID" } });
    }
  });
}

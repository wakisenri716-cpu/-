import { prisma } from "@/lib/prisma";
import type { SourceType } from "@prisma/client";

export const SOURCE_LABELS: Record<SourceType, string> = {
  EXPENSE_ITEM: "経費精算",
  INVOICE: "請求書",
  PAYMENT: "入金・支払",
  FIXED_ASSET: "固定資産",
  POS_SALE: "POSレジ",
  INVENTORY: "在庫",
  MANUAL: "手入力",
  BANK: "銀行明細",
  PAYROLL: "給料",
  REIMBURSEMENT: "立替経費の精算",
  RECURRING: "定期取引",
  IMPORT: "CSV取込",
};

export type ManualLineInput = { accountId: string; debit: number; credit: number; memo?: string | null };

export class JournalError extends Error {}

function isAmount(n: number) {
  return Number.isInteger(n) && n >= 0;
}

// 仕訳の行の入力チェック(借方・貸方のどちらか一方に金額、貸借一致、自社の勘定科目)。空の行は無視する。
export async function validateJournalLines(companyId: string, input: ManualLineInput[]) {
  const lines = input.filter((l) => l.accountId || l.debit || l.credit);
  if (lines.length < 2) throw new JournalError("仕訳は2行以上入力してください");
  for (const [i, line] of lines.entries()) {
    if (!line.accountId) throw new JournalError(`${i + 1}行目の勘定科目を選択してください`);
    if (!isAmount(line.debit) || !isAmount(line.credit)) {
      throw new JournalError(`${i + 1}行目の金額は0以上の整数で入力してください`);
    }
    if ((line.debit > 0) === (line.credit > 0)) {
      throw new JournalError(`${i + 1}行目は借方か貸方のどちらか一方に金額を入力してください`);
    }
  }

  const totalDebit = lines.reduce((sum, l) => sum + l.debit, 0);
  const totalCredit = lines.reduce((sum, l) => sum + l.credit, 0);
  if (totalDebit !== totalCredit) {
    throw new JournalError(`借方合計(¥${totalDebit.toLocaleString("ja-JP")})と貸方合計(¥${totalCredit.toLocaleString("ja-JP")})が一致しません`);
  }

  const accountIds = [...new Set(lines.map((l) => l.accountId))];
  const found = await prisma.account.count({ where: { companyId, id: { in: accountIds } } });
  if (found !== accountIds.length) throw new JournalError("存在しない勘定科目が含まれています");
  return lines;
}

export async function createManualJournal(
  companyId: string,
  input: { date: Date; description: string; lines: ManualLineInput[] },
) {
  const description = input.description.trim();
  if (!description) throw new JournalError("摘要を入力してください");
  if (Number.isNaN(input.date.getTime())) throw new JournalError("日付を正しく入力してください");
  const lines = await validateJournalLines(companyId, input.lines);

  return prisma.journalEntry.create({
    data: {
      companyId,
      date: input.date,
      description,
      sourceType: "MANUAL",
      status: "POSTED_MANUALLY",
      createdByAi: false,
      lines: {
        create: lines.map((l) => ({ accountId: l.accountId, debit: l.debit, credit: l.credit, memo: l.memo?.trim() || null })),
      },
    },
  });
}

// 手入力・定期取引・CSV取込の仕訳だけを取り消せる。経費・請求書・POS・在庫などの仕訳は元の記録と
// 紐づいているため、ここで消すと元データと帳簿が食い違ってしまう。
export const VOIDABLE_SOURCES = ["MANUAL", "RECURRING", "IMPORT"];

export async function voidManualJournal(companyId: string, id: string) {
  const entry = await prisma.journalEntry.findFirst({ where: { id, companyId } });
  if (!entry) throw new JournalError("仕訳が見つかりません");
  if (!VOIDABLE_SOURCES.includes(entry.sourceType)) throw new JournalError("手入力・定期取引・CSV取込の仕訳だけ取り消せます");
  if (entry.status === "VOID") throw new JournalError("この仕訳はすでに取り消されています");
  return prisma.journalEntry.update({ where: { id }, data: { status: "VOID" } });
}

function monthRange(month: string) {
  const [y, m] = month.split("-").map(Number);
  return { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) };
}

export async function getJournalBook(companyId: string, options: { month?: string; postedOnly?: boolean } = {}) {
  return prisma.journalEntry.findMany({
    where: {
      companyId,
      ...(options.month ? { date: monthRange(options.month) } : {}),
      ...(options.postedOnly ? { status: { in: ["AUTO_POSTED", "POSTED_MANUALLY"] } } : {}),
    },
    include: {
      lines: {
        include: { account: { select: { code: true, name: true } } },
        orderBy: [{ credit: "asc" }, { id: "asc" }],
      },
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: options.month ? undefined : 200,
  });
}

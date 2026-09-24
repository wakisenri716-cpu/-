import { prisma } from "@/lib/prisma";
import type { DateRange } from "./period";

const POSTED_STATUSES = ["AUTO_POSTED", "POSTED_MANUALLY"] as const;
const OUTPUT_TAX = "2110"; // 仮受消費税(売上で預かった消費税)
const INPUT_TAX = "1220"; // 仮払消費税(仕入・経費で支払った消費税)

export const SOURCE_LABELS: Record<string, string> = {
  EXPENSE_ITEM: "経費精算",
  INVOICE: "請求書",
  PAYMENT: "入金・支払",
  FIXED_ASSET: "固定資産",
  POS_SALE: "POSレジ",
  INVENTORY: "在庫(仕入)",
  MANUAL: "手入力の仕訳",
  BANK: "銀行明細",
  PAYROLL: "給料",
  REIMBURSEMENT: "立替経費の精算",
};

// 期間中の仮受消費税・仮払消費税を、仕訳の発生元(請求書・POSレジ・在庫など)ごとに集計する。
// 原則課税での納付見込み額 = 仮受消費税 − 仮払消費税。
export async function getConsumptionTax(companyId: string, range: DateRange = {}) {
  const lines = await prisma.journalLine.findMany({
    where: {
      account: { companyId, code: { in: [OUTPUT_TAX, INPUT_TAX] } },
      journalEntry: { companyId, status: { in: [...POSTED_STATUSES] }, ...(range.gte || range.lt ? { date: range } : {}) },
    },
    select: { debit: true, credit: true, account: { select: { code: true } }, journalEntry: { select: { sourceType: true } } },
  });

  const bySource = new Map<string, { output: number; input: number }>();
  for (const line of lines) {
    const source = line.journalEntry.sourceType;
    const row = bySource.get(source) ?? { output: 0, input: 0 };
    if (line.account.code === OUTPUT_TAX) row.output += line.credit - line.debit;
    else row.input += line.debit - line.credit;
    bySource.set(source, row);
  }

  const rows = Object.keys(SOURCE_LABELS)
    .filter((source) => bySource.has(source))
    .map((source) => ({ source, label: SOURCE_LABELS[source], ...bySource.get(source)! }));
  const outputTotal = rows.reduce((s, r) => s + r.output, 0);
  const inputTotal = rows.reduce((s, r) => s + r.input, 0);
  return { rows, outputTotal, inputTotal, payable: outputTotal - inputTotal };
}

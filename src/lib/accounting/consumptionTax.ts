import { prisma } from "@/lib/prisma";
import type { DateRange } from "./period";
import { UserError } from "@/lib/errors";

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
  RECURRING: "定期取引",
  IMPORT: "CSV取込",
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

// ---- 消費税の計算方式(原則課税・簡易課税・2割特例) ----

export const TAX_METHODS = {
  GENERAL: "原則課税",
  SIMPLIFIED: "簡易課税",
  TWENTY_PERCENT: "2割特例",
} as const;
export type TaxMethod = keyof typeof TAX_METHODS;

// 簡易課税の事業区分とみなし仕入率
export const BUSINESS_TYPES: Record<number, { label: string; example: string; rate: number }> = {
  1: { label: "第1種", example: "卸売業", rate: 0.9 },
  2: { label: "第2種", example: "小売業・農林水産業(飲食料品)", rate: 0.8 },
  3: { label: "第3種", example: "製造業・建設業・農林水産業など", rate: 0.7 },
  4: { label: "第4種", example: "飲食店業・その他", rate: 0.6 },
  5: { label: "第5種", example: "サービス業・運輸通信業・金融保険業", rate: 0.5 },
  6: { label: "第6種", example: "不動産業", rate: 0.4 },
};

export class TaxMethodError extends UserError {}

export function isTaxMethod(value: unknown): value is TaxMethod {
  return typeof value === "string" && value in TAX_METHODS;
}

// 3つの方式それぞれの納付見込み額(目安)。
// 簡易課税・2割特例は、預かった消費税から「みなし仕入率」分を差し引く(実際に払った消費税は使わない)。
export function estimateByMethod(outputTotal: number, inputTotal: number, businessType: number) {
  const rate = BUSINESS_TYPES[businessType]?.rate ?? BUSINESS_TYPES[5].rate;
  const base = Math.max(outputTotal, 0);
  return {
    GENERAL: outputTotal - inputTotal,
    SIMPLIFIED: base - Math.floor(base * rate),
    TWENTY_PERCENT: base - Math.floor(base * 0.8),
  } satisfies Record<TaxMethod, number>;
}

export async function updateTaxMethod(companyId: string, input: { method?: unknown; businessType?: unknown }) {
  if (!isTaxMethod(input.method)) throw new TaxMethodError("計算方式を選んでください");
  const businessType = Number(input.businessType ?? 5);
  if (!BUSINESS_TYPES[businessType]) throw new TaxMethodError("事業区分を選んでください");
  return prisma.company.update({
    where: { id: companyId },
    data: { consumptionTaxMethod: input.method, simplifiedBusinessType: businessType },
    select: { consumptionTaxMethod: true, simplifiedBusinessType: true },
  });
}

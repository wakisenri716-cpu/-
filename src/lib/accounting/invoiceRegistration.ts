import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import type { DateRange } from "./period";

// インボイス制度: 取引先の登録番号と、登録のない取引先(免税事業者など)からの仕入の経過措置。
// 登録のない相手への支払に含まれる消費税は、仕入税額控除が一部しかできない:
//   2023/10/1〜2026/9/30 は 80%、2026/10/1〜2029/9/30 は 50%、それ以降は 0%

const POSTED = ["AUTO_POSTED", "POSTED_MANUALLY"] as const;
const INPUT_TAX = "1220";
const NOT_CONFIRMED = { OR: [{ invoiceStatus: null }, { invoiceStatus: "NOT_REGISTERED" as const }] };

// 登録番号の検査用数字(先頭の1桁)。法人番号と同じ計算: 9 − (下の桁から奇数桁×1・偶数桁×2 の合計 を 9で割った余り)
export function checkDigit(twelve: string) {
  let sum = 0;
  for (let n = 1; n <= 12; n++) sum += Number(twelve[12 - n]) * (n % 2 === 1 ? 1 : 2);
  return 9 - (sum % 9);
}

// 「T1234567890123」の形にそろえる。全角・ハイフン・空白は取り除く。検査用数字が合わなければ警告を返す
export function normalizeRegistrationNumber(value: unknown) {
  const raw = String(value ?? "")
    .normalize("NFKC")
    .replace(/[\s\-‐ー−]/g, "")
    .toUpperCase();
  if (!raw) return null;
  const digits = raw.startsWith("T") ? raw.slice(1) : raw;
  if (!/^\d{13}$/.test(digits)) throw new UserError("登録番号は「T」と13桁の数字で入力してください(例: T1234567890123)");
  return { number: `T${digits}`, checkDigitOk: Number(digits[0]) === checkDigit(digits.slice(1)) };
}

// 国税庁の公表サイトで、その番号の登録を確かめるページ
export function kohyoUrl(number: string) {
  return `https://www.invoice-kohyo.nta.go.jp/regno-search/detail?selRegNo=${number.replace(/^T/, "")}`;
}

export function deductibleRate(dateKey: string) {
  if (dateKey < "2023-10-01") return 1;
  if (dateKey < "2026-10-01") return 0.8;
  if (dateKey < "2029-10-01") return 0.5;
  return 0;
}

export async function updateVendorInvoiceStatus(companyId: string, vendorId: string, input: { invoiceStatus?: unknown; registrationNumber?: unknown }) {
  const vendor = await prisma.vendor.findFirst({ where: { id: vendorId, companyId } });
  if (!vendor) throw new UserError("取引先が見つかりません");
  const normalized = input.registrationNumber === undefined ? undefined : normalizeRegistrationNumber(input.registrationNumber);
  let status = input.invoiceStatus === undefined ? vendor.invoiceStatus : input.invoiceStatus || null;
  if (status !== null && status !== "REGISTERED" && status !== "NOT_REGISTERED") throw new UserError("登録の状態を選んでください");
  // 番号を入れたら「登録あり」
  if (normalized) status = "REGISTERED";
  const registrationNumber = status === "NOT_REGISTERED" ? null : normalized === undefined ? vendor.registrationNumber : (normalized?.number ?? null);
  const updated = await prisma.vendor.update({ where: { id: vendorId }, data: { invoiceStatus: status, registrationNumber } });
  return { vendor: updated, warning: normalized && !normalized.checkDigitOk ? "番号の検査用数字(先頭の数字)が合いません。入力の誤りがないか、公表サイトで確かめてください" : null };
}

// 期間中の、登録のない取引先への仕入・経費に含まれる仮払消費税と、経過措置で控除できない額(目安)
export async function getTransitionalAdjustment(companyId: string, range: DateRange = {}) {
  const lines = await prisma.journalLine.findMany({
    where: {
      account: { companyId, code: INPUT_TAX },
      journalEntry: {
        companyId,
        status: { in: [...POSTED] },
        ...(range.gte || range.lt ? { date: range } : {}),
        // 登録なし・未確認(null)の取引先。Prisma の not は null を含まないので、OR で両方を指定する
        OR: [{ invoice: { vendor: NOT_CONFIRMED } }, { expenseItem: { vendor: NOT_CONFIRMED } }],
      },
    },
    select: {
      debit: true,
      credit: true,
      journalEntry: {
        select: {
          date: true,
          invoice: { select: { vendor: { select: { id: true, name: true, invoiceStatus: true } } } },
          expenseItem: { select: { vendor: { select: { id: true, name: true, invoiceStatus: true } } } },
        },
      },
    },
  });
  const buckets = new Map<number, { rate: number; tax: number }>();
  const vendors = new Map<string, { id: string; name: string; status: "NOT_REGISTERED" | "UNKNOWN"; tax: number }>();
  for (const l of lines) {
    const vendor = l.journalEntry.invoice?.vendor ?? l.journalEntry.expenseItem?.vendor;
    if (!vendor) continue;
    const tax = l.debit - l.credit;
    const v = vendors.get(vendor.id) ?? { id: vendor.id, name: vendor.name, status: vendor.invoiceStatus === "NOT_REGISTERED" ? "NOT_REGISTERED" : "UNKNOWN", tax: 0 };
    v.tax += tax;
    vendors.set(vendor.id, v);
    // 控除を減らすのは「登録なし」と確かめた取引先だけ。未確認の取引先は確認を促す
    if (vendor.invoiceStatus !== "NOT_REGISTERED") continue;
    const rate = deductibleRate(jstDateKey(l.journalEntry.date));
    const b = buckets.get(rate) ?? { rate, tax: 0 };
    b.tax += tax;
    buckets.set(rate, b);
  }
  const rows = [...buckets.values()]
    .sort((a, b) => b.rate - a.rate)
    .map((b) => ({ ...b, deductible: Math.floor(b.tax * b.rate), notDeductible: b.tax - Math.floor(b.tax * b.rate) }));
  const list = [...vendors.values()].sort((a, b) => b.tax - a.tax);
  return {
    rows,
    notDeductible: rows.reduce((s, r) => s + r.notDeductible, 0),
    notRegistered: list.filter((v) => v.status === "NOT_REGISTERED"),
    unknown: list.filter((v) => v.status === "UNKNOWN"),
  };
}

export function rateLabel(rate: number) {
  if (rate === 0.8) return "2026年9月まで(80%控除)";
  if (rate === 0.5) return "2026年10月〜2029年9月(50%控除)";
  if (rate === 0) return "2029年10月から(控除なし)";
  return "インボイス制度の前(全額控除)";
}

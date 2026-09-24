import { prisma } from "@/lib/prisma";
import { jstDateKey } from "@/lib/jst";

// 仕訳の日付は「日付のみ(UTC 0時)」で保存しているので、期間も YYYY-MM-DD の日付キーで扱う
export type DateRange = { gte?: Date; lt?: Date };

export const PRESETS = [
  { key: "this-fy", label: "今期" },
  { key: "last-fy", label: "前期" },
  { key: "this-month", label: "今月" },
  { key: "last-month", label: "先月" },
  { key: "all", label: "すべて" },
] as const;

export type Preset = (typeof PRESETS)[number]["key"] | "custom";
export type Period = { preset: Preset; from: string | null; to: string | null; label: string };
export type PeriodParams = { preset?: string; from?: string; to?: string; asOf?: string };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function key(y: number, m: number, d: number) {
  return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
}

function validKey(value: string | undefined) {
  return value && DATE.test(value) && key(...(value.split("-").map(Number) as [number, number, number])) === value ? value : null;
}

export function nextDay(k: string) {
  return new Date(Date.parse(`${k}T00:00:00Z`) + 86_400_000);
}

function display(k: string) {
  const [y, m, d] = k.split("-").map(Number);
  return `${y}/${m}/${d}`;
}

export async function getFiscalStartMonth(companyId: string) {
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { fiscalYearStartMonth: true } });
  return company?.fiscalYearStartMonth ?? 4;
}

export function fiscalYearOf(today: string, startMonth: number) {
  const [y, m] = today.split("-").map(Number);
  const startYear = m >= startMonth ? y : y - 1;
  return { from: key(startYear, startMonth, 1), to: key(startYear + 1, startMonth, 0), year: startYear };
}

export function resolvePeriod(params: PeriodParams, startMonth: number, today = jstDateKey(new Date())): Period {
  const from = validKey(params.from);
  const to = validKey(params.to);
  if (params.preset === "custom" || (!params.preset && (from || to))) {
    if (from && to && from > to) return resolvePeriod({ preset: "custom", from: to, to: from }, startMonth, today);
    return { preset: "custom", from, to, label: `${from ? display(from) : "最初"}〜${to ? display(to) : "最新"}` };
  }
  const [y, m] = today.split("-").map(Number);
  switch (params.preset) {
    case "all":
      return { preset: "all", from: null, to: null, label: "すべての期間" };
    case "this-month":
      return { preset: "this-month", from: key(y, m, 1), to: key(y, m + 1, 0), label: `${y}年${m}月` };
    case "last-month": {
      const d = new Date(Date.UTC(y, m - 2, 1));
      const [ly, lm] = [d.getUTCFullYear(), d.getUTCMonth() + 1];
      return { preset: "last-month", from: key(ly, lm, 1), to: key(ly, lm + 1, 0), label: `${ly}年${lm}月` };
    }
    case "last-fy": {
      const current = fiscalYearOf(today, startMonth);
      const dayBefore = new Date(Date.parse(`${current.from}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
      const fy = fiscalYearOf(dayBefore, startMonth);
      return { preset: "last-fy", from: fy.from, to: fy.to, label: `${fy.year}年度(${display(fy.from)}〜${display(fy.to)})` };
    }
    default: {
      const fy = fiscalYearOf(today, startMonth);
      return { preset: "this-fy", from: fy.from, to: fy.to, label: `${fy.year}年度(${display(fy.from)}〜${display(fy.to)})` };
    }
  }
}

export function resolveAsOf(params: PeriodParams, today = jstDateKey(new Date())) {
  const asOf = validKey(params.asOf) ?? today;
  return { asOf, label: `${display(asOf)}時点` };
}

export function toRange(period: { from: string | null; to: string | null }): DateRange {
  return {
    ...(period.from ? { gte: new Date(`${period.from}T00:00:00Z`) } : {}),
    ...(period.to ? { lt: nextDay(period.to) } : {}),
  };
}

export function periodQuery(period: Period) {
  const q = new URLSearchParams({ preset: period.preset });
  if (period.preset === "custom") {
    if (period.from) q.set("from", period.from);
    if (period.to) q.set("to", period.to);
  }
  return q.toString();
}

export function paramsFromUrl(url: string): PeriodParams {
  const q = new URL(url).searchParams;
  return {
    preset: q.get("preset") ?? undefined,
    from: q.get("from") ?? undefined,
    to: q.get("to") ?? undefined,
    asOf: q.get("asOf") ?? undefined,
  };
}

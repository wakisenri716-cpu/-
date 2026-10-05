// 減価償却の計算(DBに触らない)。定額法は月割りの定額、定率法は平成24年4月1日以後に取得した資産の200%定率法。
// 年度(会社の事業年度)ごとの償却額を出し、月次の計上ではその年度の額を月数で割る(年度の最後の月で端数を合わせる)。

export type DepreciationMethod = "STRAIGHT" | "DECLINING";
export const METHOD_LABEL: Record<DepreciationMethod, string> = { STRAIGHT: "定額法", DECLINING: "定率法" };

// 200%定率法の償却率・改定償却率・保証率(耐用年数 2〜20年)
const DECLINING_RATES: Record<number, [number, number, number]> = {
  2: [1.0, 0, 0],
  3: [0.667, 1.0, 0.11089],
  4: [0.5, 1.0, 0.12499],
  5: [0.4, 0.5, 0.108],
  6: [0.333, 0.334, 0.09911],
  7: [0.286, 0.334, 0.0868],
  8: [0.25, 0.334, 0.07909],
  9: [0.222, 0.25, 0.07126],
  10: [0.2, 0.25, 0.06552],
  11: [0.182, 0.2, 0.05992],
  12: [0.167, 0.2, 0.05566],
  13: [0.154, 0.167, 0.0518],
  14: [0.143, 0.167, 0.04854],
  15: [0.133, 0.143, 0.04565],
  16: [0.125, 0.143, 0.04294],
  17: [0.118, 0.125, 0.04038],
  18: [0.111, 0.112, 0.03884],
  19: [0.105, 0.112, 0.03693],
  20: [0.1, 0.112, 0.03486],
};
export const DECLINING_MAX_LIFE = 20;

export function decliningRates(life: number) {
  const r = DECLINING_RATES[life];
  return r ? { rate: r[0], revisedRate: r[1], guarantee: r[2] } : null;
}

export function parseMethod(value: unknown, life: number): DepreciationMethod {
  const method = value === "DECLINING" ? "DECLINING" : "STRAIGHT";
  if (method === "DECLINING" && !decliningRates(life)) throw new Error(`定率法は耐用年数2〜${DECLINING_MAX_LIFE}年の資産で使えます`);
  return method;
}

type AssetLike = { method: string; acquisitionCost: number; residualValue: number; usefulLifeYears: number; acquisitionMonth: string };

export type ScheduleYear = {
  fiscalYear: number; // 年度(始まりの年)
  from: string; // 償却する最初の月 YYYY-MM
  to: string; // 年度の最後の月 YYYY-MM
  months: number;
  opening: number; // 期首帳簿価額
  amount: number; // その年度の償却額
  closing: number; // 期末帳簿価額
  revised: boolean; // 定率法で改定償却率に切り替えた年
};

const addMonths = (ym: string, n: number) => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
const monthsBetween = (from: string, to: string) => {
  const [y1, m1] = from.split("-").map(Number);
  const [y2, m2] = to.split("-").map(Number);
  return (y2 - y1) * 12 + (m2 - m1) + 1;
};
// その月を含む年度の最後の月
function fiscalEnd(ym: string, startMonth: number) {
  const [y, m] = ym.split("-").map(Number);
  const startYear = m >= startMonth ? y : y - 1;
  return { fiscalYear: startYear, end: addMonths(`${startYear}-${String(startMonth).padStart(2, "0")}`, 11) };
}

// 定額法の月額(取得価額 − 残存価額)÷(耐用年数 × 12)
export function straightMonthly(cost: number, residual: number, life: number) {
  return Math.floor((cost - residual) / (life * 12));
}

// 年度ごとの償却予定表
export function depreciationSchedule(asset: AssetLike, fiscalStartMonth: number): ScheduleYear[] {
  const rows: ScheduleYear[] = [];
  const { acquisitionCost: cost, residualValue: residual, usefulLifeYears: life } = asset;
  let opening = cost;
  let from = asset.acquisitionMonth;
  const rates = asset.method === "DECLINING" ? decliningRates(life) : null;
  const monthly = straightMonthly(cost, residual, life);
  let revisedBase: number | null = null;
  for (let i = 0; i < 200 && opening > residual; i++) {
    const { fiscalYear, end } = fiscalEnd(from, fiscalStartMonth);
    const months = monthsBetween(from, end);
    let amount: number;
    let revised = false;
    if (rates) {
      // 調整前償却額が償却保証額に満たなくなったら、その年の期首帳簿価額 × 改定償却率に切り替える
      const before = opening * rates.rate;
      if (revisedBase === null && rates.guarantee > 0 && before < cost * rates.guarantee) revisedBase = opening;
      revised = revisedBase !== null;
      const yearly = revisedBase !== null ? revisedBase * rates.revisedRate : before;
      amount = Math.floor((yearly * months) / 12);
    } else {
      amount = monthly * months;
    }
    // 最後は残存価額(1円)まで。定額法の割り切れない端数も最後の月で償却する
    amount = Math.min(amount, opening - residual);
    if (amount <= 0) amount = opening - residual;
    rows.push({ fiscalYear, from, to: end, months, opening, amount, closing: opening - amount, revised });
    opening -= amount;
    from = addMonths(end, 1);
  }
  return rows;
}

// その月に計上する額。年度の最後の月は、その年度にすでに計上した額との差で合わせる。
// postedInYear: その年度にこの資産で計上済みの額、remaining: 実際の残り(取得価額 − 残存価額 − 累計)
export function monthlyAmountFor(asset: AssetLike, fiscalStartMonth: number, period: string, postedInYear: number, remaining: number) {
  if (remaining <= 0) return 0;
  const schedule = depreciationSchedule(asset, fiscalStartMonth);
  const year = schedule.find((y) => y.from <= period && period <= y.to);
  if (!year) return period > (schedule.at(-1)?.to ?? period) ? remaining : 0;
  if (asset.method !== "DECLINING") {
    const monthly = straightMonthly(asset.acquisitionCost, asset.residualValue, asset.usefulLifeYears);
    return Math.min(monthly > 0 ? monthly : remaining, remaining);
  }
  const monthly = Math.floor(year.amount / year.months);
  const amount = period === year.to ? year.amount - postedInYear : monthly;
  return Math.max(0, Math.min(amount, remaining));
}

// 年度の範囲(月) — 計上済みの額を年度で集計するため
export function fiscalRangeOf(period: string, fiscalStartMonth: number) {
  const { fiscalYear, end } = fiscalEnd(period, fiscalStartMonth);
  return { fiscalYear, from: addMonths(end, -11), to: end };
}

import { nextBusinessDay } from "@/lib/holidays";

// 報酬の源泉徴収と、源泉所得税・住民税の納付期限のきまり。DB を使わない計算だけを置く。

// 報酬の種類。士業の報酬だけは、給与と同じく源泉所得税の「納期の特例」(年2回払い)が使える
export const FEE_CATEGORIES = {
  DESIGN: "原稿料・デザイン料など",
  LECTURE: "講演料・出演料など",
  PROFESSIONAL: "税理士・弁護士・社労士などの報酬",
  OTHER: "その他の報酬",
} as const;
export type FeeCategory = keyof typeof FEE_CATEGORIES;

// 源泉徴収税額: 100万円までは10.21%、超えた部分は20.42%(1円未満切り捨て)。司法書士などの1万円控除は扱わない
export function feeWithholding(base: number) {
  if (base <= 0) return 0;
  if (base <= 1_000_000) return Math.floor((base * 1021) / 10000);
  return Math.floor(102_100 + ((base - 1_000_000) * 2042) / 10000);
}

const pad = (n: number) => String(n).padStart(2, "0");
export const monthKey = (y: number, m: number) => {
  const d = new Date(Date.UTC(y, m - 1, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
};
export const addMonth = (month: string, n: number) => {
  const [y, m] = month.split("-").map(Number);
  return monthKey(y, m + n);
};

// 期限が土日・祝日・年末年始(12/29〜1/3)なら次の営業日(国税通則法10条2項・地方税法20条の5と同じ考え方)
export function businessDay(y: number, m: number, d: number) {
  return nextBusinessDay(new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10), "tax");
}

export type Period = { key: string; label: string; months: string[]; deadline: string };

// 毎月納付: 支払った月の翌月10日
export function monthlyPeriod(month: string): Period {
  const [y, m] = month.split("-").map(Number);
  const next = addMonth(month, 1).split("-").map(Number);
  return { key: month, label: `${y}年${m}月分`, months: [month], deadline: businessDay(next[0], next[1], 10) };
}

// 源泉所得税の納期の特例: 1〜6月分は7月10日、7〜12月分は翌年1月20日
export function incomeTaxSpecialPeriod(month: string): Period {
  const [y, m] = month.split("-").map(Number);
  const first = m <= 6;
  const start = first ? 1 : 7;
  return {
    key: `${y}-${pad(start)}~${y}-${pad(start + 5)}`,
    label: `${y}年${start}〜${start + 5}月分`,
    months: Array.from({ length: 6 }, (_, i) => monthKey(y, start + i)),
    deadline: first ? businessDay(y, 7, 10) : businessDay(y + 1, 1, 20),
  };
}

// 住民税の納期の特例: 6〜11月分は12月10日、12〜翌5月分は6月10日
export function residentTaxSpecialPeriod(month: string): Period {
  const [y, m] = month.split("-").map(Number);
  const inFirst = m >= 6 && m <= 11;
  const start = inFirst ? monthKey(y, 6) : monthKey(m === 12 ? y : y - 1, 12);
  const months = Array.from({ length: 6 }, (_, i) => addMonth(start, i));
  const [sy, sm] = start.split("-").map(Number);
  const [ey, em] = months[5].split("-").map(Number);
  return {
    key: `${start}~${months[5]}`,
    label: `${sy}年${sm}月〜${ey}年${em}月分`,
    months,
    deadline: inFirst ? businessDay(sy, 12, 10) : businessDay(ey, 6, 10),
  };
}

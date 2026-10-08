import { isBusinessDay } from "@/lib/holidays";

// 繰り返しのやること(毎日・毎週◯曜・毎月◯日・毎月末)。画面とサーバーの両方で使う
// 形式: "DAILY"(営業日の毎日。土日・祝日・年末年始は飛ばす) / "WEEKLY:1"(0=日〜6=土) / "MONTHLY:25" / "MONTHLY:END"

const DAY = 86_400_000;
const WEEK = "日月火水木金土";

const addDays = (key: string, n: number) =>
  new Date(Date.parse(`${key}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const weekday = (key: string) => new Date(`${key}T00:00:00Z`).getUTCDay();
const lastDay = (y: number, m: number) =>
  new Date(Date.UTC(y, m, 0)).getUTCDate();

export function validRepeat(v: unknown): v is string {
  if (typeof v !== "string") return false;
  if (v === "DAILY" || v === "MONTHLY:END") return true;
  const w = v.match(/^WEEKLY:([0-6])$/);
  if (w) return true;
  const m = v.match(/^MONTHLY:(\d{1,2})$/);
  return !!m && Number(m[1]) >= 1 && Number(m[1]) <= 31;
}

// from 以降(from を含む)で最初の日
export function nextDue(repeat: string, from: string): string {
  if (repeat === "DAILY") {
    let d = from;
    // 毎日は営業日だけ(土日・祝日・年末年始を飛ばす)
    while (!isBusinessDay(d)) d = addDays(d, 1);
    return d;
  }
  const w = repeat.match(/^WEEKLY:([0-6])$/);
  if (w) return addDays(from, (Number(w[1]) - weekday(from) + 7) % 7);
  const [y, m] = from.split("-").map(Number);
  const inMonth = (yy: number, mm: number) => {
    const last = lastDay(yy, mm);
    const day =
      repeat === "MONTHLY:END" ? last : Math.min(Number(repeat.slice(8)), last);
    return `${yy}-${String(mm).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  };
  const here = inMonth(y, m);
  return here >= from ? here : m === 12 ? inMonth(y + 1, 1) : inMonth(y, m + 1);
}

// 済んだ回の次(前の期限の翌日以降で、今日より前にはしない)
export function followingDue(
  repeat: string,
  prevDue: string | null,
  today: string,
) {
  const after = prevDue ? addDays(prevDue, 1) : today;
  return nextDue(repeat, after > today ? after : today);
}

export function repeatLabel(repeat: string | null | undefined) {
  if (!repeat) return null;
  if (repeat === "DAILY") return "毎日(平日)";
  if (repeat === "MONTHLY:END") return "毎月末";
  const w = repeat.match(/^WEEKLY:([0-6])$/);
  if (w) return `毎週${WEEK[Number(w[1])]}曜`;
  const m = repeat.match(/^MONTHLY:(\d{1,2})$/);
  return m ? `毎月${Number(m[1])}日` : null;
}

// 文の中の「毎週月曜」「毎月25日」「毎月末」「毎日」
const REPEAT_WORDS =
  /\s*(?:平日の?)?毎日|\s*毎週\s*[月火水木金土日]曜日?|\s*毎月\s*(?:末|月末|末日|\d{1,2}\s*日)|\s*月末ごと/;
export function parseRepeat(
  text: string,
): { repeat: string; rest: string } | null {
  const t = text.normalize("NFKC");
  const hit = t.match(REPEAT_WORDS);
  if (!hit) return null;
  const s = hit[0];
  let repeat: string | null = null;
  const w = s.match(/毎週\s*([月火水木金土日])曜/);
  const m = s.match(/毎月\s*(\d{1,2})\s*日/);
  if (w) repeat = `WEEKLY:${WEEK.indexOf(w[1])}`;
  else if (m && Number(m[1]) >= 1 && Number(m[1]) <= 31)
    repeat = `MONTHLY:${Number(m[1])}`;
  else if (/末|月末ごと/.test(s)) repeat = "MONTHLY:END";
  else if (/毎日/.test(s)) repeat = "DAILY";
  if (!repeat) return null;
  const rest = t
    .replace(hit[0], " ")
    .replace(/^\s*(?:に|は|、)\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
  return { repeat, rest };
}

export const REPEAT_OPTIONS: { value: string; label: string }[] = [
  { value: "DAILY", label: "毎日(平日)" },
  ...[1, 2, 3, 4, 5, 6, 0].map((d) => ({
    value: `WEEKLY:${d}`,
    label: `毎週${WEEK[d]}曜`,
  })),
  ...Array.from({ length: 31 }, (_, i) => ({
    value: `MONTHLY:${i + 1}`,
    label: `毎月${i + 1}日`,
  })),
  { value: "MONTHLY:END", label: "毎月末" },
];

// よくある定例の事務(ひとことで入れるときの例)
export const ROUTINE_EXAMPLES = [
  "毎月10日 源泉所得税・住民税を納付する",
  "毎月25日 給料を振り込む",
  "毎月末 請求書を発行する",
  "毎月末 経費精算を締める",
  "毎週月曜 先週の売上を報告する",
  "毎日 郵便物を確認する",
];

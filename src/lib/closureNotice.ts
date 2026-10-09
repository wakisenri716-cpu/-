import { isBusinessDay } from "@/lib/holidays";

// 会社の休業日のお知らせ(画面とサーバーの両方で使う)。
// 続いている同じ名前の休業日を1つにまとめ、前後の土日・祝日もつなげた「お休みの期間」と、営業を始める日を出す。

export type Closure = { date: string; name: string };
export type ClosureGroup = { name: string; dates: string[] };

const DAY = 86_400_000;
const WEEK = "日月火水木金土";
const addDays = (key: string, n: number) => new Date(Date.parse(`${key}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const weekday = (key: string) => WEEK[new Date(`${key}T00:00:00Z`).getUTCDay()];

// 2026年8月13日(木)
export const jpDate = (key: string) => `${Number(key.slice(0, 4))}年${Number(key.slice(5, 7))}月${Number(key.slice(8, 10))}日(${weekday(key)})`;
// 8/13(木)
export const shortDate = (key: string) => `${Number(key.slice(5, 7))}/${Number(key.slice(8, 10))}(${weekday(key)})`;

// 続いている同じ名前の日をまとめる(日付の順に並んだ一覧を渡す)
export function groupClosures(list: Closure[]): ClosureGroup[] {
  const out: ClosureGroup[] = [];
  for (const c of list) {
    const last = out[out.length - 1];
    const prev = last?.dates[last.dates.length - 1];
    if (last && last.name === c.name && prev && addDays(prev, 1) === c.date) last.dates.push(c.date);
    else out.push({ name: c.name, dates: [c.date] });
  }
  return out;
}

export type ClosureNotice = {
  name: string;
  from: string; // 前後の土日・祝日を含めたお休みの始まり
  to: string;
  days: number;
  restart: string; // 営業を始める日
  period: string; // 「2026年8月13日(木)〜2026年8月17日(月)」
  restartText: string;
};

export function closureNotice(group: ClosureGroup, closures: Map<string, string>): ClosureNotice {
  const off = (d: string) => !isBusinessDay(d) || closures.has(d);
  let from = group.dates[0];
  let to = group.dates[group.dates.length - 1];
  for (let i = 0; i < 14 && off(addDays(from, -1)); i++) from = addDays(from, -1);
  for (let i = 0; i < 14 && off(addDays(to, 1)); i++) to = addDays(to, 1);
  const restart = addDays(to, 1);
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY) + 1;
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  const toText = sameYear ? jpDate(to).replace(/^\d+年/, "") : jpDate(to);
  return { name: group.name, from, to, days, restart, period: from === to ? jpDate(from) : `${jpDate(from)}〜${toText}`, restartText: jpDate(restart) };
}

// 社内のお知らせ(従業員も読む)
export function staffAnnouncement(n: ClosureNotice) {
  return {
    title: `${n.name}のお知らせ(${shortDate(n.from)}${n.from === n.to ? "" : `〜${shortDate(n.to)}`})`,
    body: [
      `${n.period}は${n.name}のため、会社はお休みです(${n.days}日間)。`,
      `${n.restartText}から通常どおりです。`,
      "",
      "お休みの前に、次のことを済ませておいてください。",
      "・振込・入金の確認など、銀行の手続き",
      "・取引先へのお休みのご連絡(お知らせ状・メール)",
      "・メールの自動返信や留守番電話の設定",
      "・お休み中が期限のやることの前倒し",
    ].join("\n"),
  };
}

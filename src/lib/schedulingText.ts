import { isBusinessDay, holidayName } from "@/lib/holidays";

// 日程調整: 候補の日時と、メールの本文(画面とサーバーの両方で使う)
export type Slot = { date: string; start: string; end: string };
export type Place = "online" | "visit" | "come" | "other";
export const PLACE_LABEL: Record<Place, string> = {
  online: "オンライン(Web会議)",
  visit: "貴社へお伺い",
  come: "弊社へお越しいただく",
  other: "相談して決める",
};

const WEEK = "日月火水木金土";
const addDays = (key: string, n: number) =>
  new Date(Date.parse(`${key}T00:00:00Z`) + n * 86_400_000)
    .toISOString()
    .slice(0, 10);
const toMin = (hm: string) =>
  Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
const toHm = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export function slotLabel(s: Slot) {
  const w = WEEK[new Date(`${s.date}T00:00:00Z`).getUTCDay()];
  return `${Number(s.date.slice(5, 7))}月${Number(s.date.slice(8, 10))}日(${w}) ${s.start}〜${s.end}`;
}

// 候補: 何日後から、営業日だけ、1日に1つずつ。時間帯で始まりの時刻を変える
export function suggestSlots(opts: {
  today: string;
  after: number;
  count: number;
  minutes: number;
  time: "am" | "pm" | "any";
  busy?: string[];
}) {
  const starts =
    opts.time === "am"
      ? ["10:00", "11:00"]
      : opts.time === "pm"
        ? ["14:00", "15:00", "16:00"]
        : ["10:00", "14:00", "16:00"];
  const busy = new Set(opts.busy ?? []);
  const out: Slot[] = [];
  let d = addDays(opts.today, Math.max(1, opts.after));
  for (let i = 0; out.length < opts.count && i < 60; i++, d = addDays(d, 1)) {
    if (!isBusinessDay(d) || busy.has(d)) continue;
    const start = starts[out.length % starts.length];
    const end = toMin(start) + opts.minutes;
    if (end > 18 * 60) continue;
    out.push({ date: d, start, end: toHm(end) });
  }
  return out;
}

// 候補のおかしいところ(休みの日・過ぎた日・時刻の前後)
export function slotWarnings(slots: Slot[], today: string) {
  return slots.flatMap((s) => {
    const w: string[] = [];
    if (s.date <= today) w.push(`${slotLabel(s)}は今日より前か今日です`);
    else if (!isBusinessDay(s.date))
      w.push(
        `${slotLabel(s)}は休みの日(${holidayName(s.date) ?? "土日・年末年始"})です`,
      );
    if (s.end <= s.start)
      w.push(`${slotLabel(s)}の終わりの時刻が始まりより前です`);
    return w;
  });
}

export type MailParts = {
  to: string;
  me: { company: string; name: string };
  purpose: string;
  place: Place;
  minutes: number;
  slots: Slot[];
  intro?: string | null;
  closing?: string | null;
};

export function schedulingMail(p: MailParts) {
  const intro =
    p.intro?.trim() ||
    `${p.purpose ? `${p.purpose}につきまして、` : ""}お打ち合わせのお時間をいただけますと幸いです。\n下記の日程でご都合のよいものはございますでしょうか。`;
  const closing =
    p.closing?.trim() ||
    "ご都合のよい日時をお知らせいただけますと幸いです。\nいずれも難しい場合は、ご都合のよい日をいくつかお教えください。こちらで調整いたします。";
  return [
    p.to,
    "",
    `いつもお世話になっております。${p.me.company}の${p.me.name}です。`,
    "",
    intro,
    "",
    "【候補日時】",
    ...p.slots.map((s, i) => `${i + 1}. ${slotLabel(s)}`),
    "",
    `【所要時間】${p.minutes}分ほど`,
    `【場所】${PLACE_LABEL[p.place]}`,
    "",
    closing,
    "",
    "どうぞよろしくお願いいたします。",
    "",
    "--",
    p.me.company,
    p.me.name,
  ].join("\n");
}

export function schedulingSubject(purpose: string, company: string) {
  return `お打ち合わせ日程のご相談${purpose ? `(${purpose.slice(0, 30)})` : ""}【${company}】`;
}

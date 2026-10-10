// 会議室・社用車の予約(画面とサーバーの両方で使う)。「14時から15時」「14:00-15:30」「午後2時から1時間」などの時刻を読む。

export const FACILITY_KINDS = { ROOM: "会議室", CAR: "社用車", OTHER: "そのほか" } as const;
export type FacilityKind = keyof typeof FACILITY_KINDS;

const pad = (n: number) => String(n).padStart(2, "0");
export const toMin = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
export const toHM = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
export const validHM = (v: unknown): v is string => typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

// 1つの時刻(「14時」「14時半」「14:30」「午後2時」)を分にする
function clock(s: string, pm: boolean): number | null {
  const m = s.match(/(\d{1,2})(?::(\d{2})|時(半|(\d{1,2})分)?)/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : m[3] === "半" ? 30 : m[4] ? Number(m[4]) : 0;
  if (pm && h < 12) h += 12;
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

// 文から始まりと終わりの時刻を読む。終わりがなければ minutes(既定60分)
export function parseTimeRange(text: string, minutes = 60): { start: string; end: string } | null {
  // 「10時から1時間」の「1時間」は終わりの時刻ではなく長さ(区切りを外して、長さとして読む)
  const t = text
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .replace(/(から|〜|~|-|ー|–)\s*(\d{1,2}\s*時間半?|\d{2,3}\s*分間?)/, " $2");
  const pm = /午後|PM|pm/.test(t);
  const range = t.match(/(午前|午後)?\s*(\d{1,2}(?::\d{2}|時(?:半|\d{1,2}分)?))\s*(?:から|〜|~|-|ー|–)\s*(午前|午後)?\s*(\d{1,2}(?::\d{2}|時(?:半|\d{1,2}分)?))?/);
  if (range) {
    const start = clock(range[2], range[1] === "午後" || (!range[1] && pm && !range[3]));
    if (start === null) return null;
    let end: number | null = range[4] ? clock(range[4], range[3] === "午後" || (!range[3] && (range[1] === "午後" || pm))) : null;
    // 「14時から3時」のように終わりが小さければ午後とみなす
    if (end !== null && end <= start && end + 12 * 60 > start && end < 12 * 60) end += 12 * 60;
    const dur = t.match(/(\d{1,2})\s*時間(半)?|(\d{2,3})\s*分間?/);
    if (end === null && dur) end = start + (dur[1] ? Number(dur[1]) * 60 + (dur[2] ? 30 : 0) : Number(dur[3]));
    if (end === null) end = start + minutes;
    if (end <= start || end > 24 * 60) return null;
    return { start: toHM(start), end: toHM(Math.min(end, 23 * 60 + 59)) };
  }
  const one = t.match(/(午前|午後)?\s*(\d{1,2}(?::\d{2}|時(?:半|\d{1,2}分)?))/);
  if (!one) return null;
  const start = clock(one[2], one[1] === "午後" || pm);
  if (start === null) return null;
  const dur = t.match(/(\d{1,2})\s*時間(半)?|(\d{2,3})\s*分間?/);
  const end = start + (dur ? (dur[1] ? Number(dur[1]) * 60 + (dur[2] ? 30 : 0) : Number(dur[3])) : minutes);
  if (end > 24 * 60) return null;
  return { start: toHM(start), end: toHM(end) };
}

// 時間が重なっているか(終わりと始まりが同じなら重ならない)
export const overlaps = (a: { start: string; end: string }, b: { start: string; end: string }) => a.start < b.end && b.start < a.end;

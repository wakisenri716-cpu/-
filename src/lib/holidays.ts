// 日本の祝日(「国民の祝日に関する法律」の今のきまり。2022年以降を正しく出す)と営業日の計算。画面とサーバーの両方で使う。
// ・ハッピーマンデー(成人の日・海の日・敬老の日・スポーツの日)
// ・春分の日・秋分の日は天文の近似式(1980〜2099年)
// ・振替休日(祝日が日曜なら、その後の最初の祝日でない日)と国民の休日(祝日にはさまれた日)

const DAY = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");
const keyOf = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const addDays = (key: string, n: number) =>
  new Date(Date.parse(`${key}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const weekday = (key: string) => new Date(`${key}T00:00:00Z`).getUTCDay();

// その月の第n月曜日
function nthMonday(y: number, m: number, n: number) {
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  return 1 + ((8 - first) % 7) + (n - 1) * 7;
}

const vernal = (y: number) =>
  Math.floor(20.8431 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
const autumnal = (y: number) =>
  Math.floor(23.2488 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));

const cache = new Map<number, Map<string, string>>();

// その年の祝日(日付 → 名前)
export function holidaysOf(y: number): Map<string, string> {
  const hit = cache.get(y);
  if (hit) return hit;
  const base: [string, string][] = [
    [keyOf(y, 1, 1), "元日"],
    [keyOf(y, 1, nthMonday(y, 1, 2)), "成人の日"],
    [keyOf(y, 2, 11), "建国記念の日"],
    [keyOf(y, 2, 23), "天皇誕生日"],
    [keyOf(y, 3, vernal(y)), "春分の日"],
    [keyOf(y, 4, 29), "昭和の日"],
    [keyOf(y, 5, 3), "憲法記念日"],
    [keyOf(y, 5, 4), "みどりの日"],
    [keyOf(y, 5, 5), "こどもの日"],
    [keyOf(y, 7, nthMonday(y, 7, 3)), "海の日"],
    [keyOf(y, 8, 11), "山の日"],
    [keyOf(y, 9, nthMonday(y, 9, 3)), "敬老の日"],
    [keyOf(y, 9, autumnal(y)), "秋分の日"],
    [keyOf(y, 10, nthMonday(y, 10, 2)), "スポーツの日"],
    [keyOf(y, 11, 3), "文化の日"],
    [keyOf(y, 11, 23), "勤労感謝の日"],
  ];
  const map = new Map(base);
  // 国民の休日: 前の日と次の日が祝日で、日曜でも祝日でもない日
  for (const [k] of base) {
    const mid = addDays(k, 1);
    if (!map.has(mid) && map.has(addDays(k, 2)) && weekday(mid) !== 0)
      map.set(mid, "国民の休日");
  }
  // 振替休日: 祝日が日曜なら、その後の最初の祝日でない日
  for (const [k] of [...map]) {
    if (weekday(k) !== 0) continue;
    let d = addDays(k, 1);
    while (map.has(d)) d = addDays(d, 1);
    map.set(d, "振替休日");
  }
  const sorted = new Map([...map].sort(([a], [b]) => (a < b ? -1 : 1)));
  cache.set(y, sorted);
  return sorted;
}

export function holidayName(key: string): string | null {
  return holidaysOf(Number(key.slice(0, 4))).get(key) ?? null;
}

// 年末年始: closing="tax" は12/29〜1/3(税金・役所の期限)、"bank" は12/31〜1/3(銀行)
function yearEnd(key: string, closing: "tax" | "bank") {
  const md = key.slice(5);
  return md <= "01-03" || md >= (closing === "tax" ? "12-29" : "12-31");
}

// 営業日(土日・祝日・年末年始でない日)
export function isBusinessDay(key: string, closing: "tax" | "bank" = "tax") {
  const w = weekday(key);
  return w !== 0 && w !== 6 && !holidayName(key) && !yearEnd(key, closing);
}

// その日以降(その日を含む)の最初の営業日
export function nextBusinessDay(key: string, closing: "tax" | "bank" = "tax") {
  let d = key;
  while (!isBusinessDay(d, closing)) d = addDays(d, 1);
  return d;
}

// その日以前(その日を含む)の最後の営業日
export function prevBusinessDay(key: string, closing: "tax" | "bank" = "tax") {
  let d = key;
  while (!isBusinessDay(d, closing)) d = addDays(d, -1);
  return d;
}

// 休みの理由(「土曜日」「スポーツの日」「年末年始」)。営業日なら null
export function closedReason(key: string, closing: "tax" | "bank" = "tax") {
  const name = holidayName(key);
  if (name) return name;
  const w = weekday(key);
  if (w === 0) return "日曜日";
  if (w === 6) return "土曜日";
  if (yearEnd(key, closing)) return "年末年始";
  return null;
}

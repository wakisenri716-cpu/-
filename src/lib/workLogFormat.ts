// 日報の表示用(画面からも使うので、データベースには触らない)

// 90 → 「1時間30分」
export function formatDuration(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m}分`;
  return m ? `${h}時間${m}分` : `${h}時間`;
}

// "2026-09" を n か月ずらす
export function shiftMonth(month: string, n: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function weekday(date: string) {
  return "日月火水木金土"[new Date(`${date}T00:00:00Z`).getUTCDay()];
}

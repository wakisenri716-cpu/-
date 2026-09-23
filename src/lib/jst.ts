const JST_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

// 日本時間での日付(YYYY-MM-DD)。サーバーのタイムゾーン(VercelはUTC)に左右されない。
export function jstDateKey(date: Date): string {
  return JST_DATE.format(date);
}

export function jstMidnight(key: string): Date {
  return new Date(`${key}T00:00:00+09:00`);
}

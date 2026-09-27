// 年次有給休暇のきまり(労働基準法39条)。DB を使わない計算だけを置く。日数はすべて半日単位(1日 = 2)。
// - 入社から6か月で付与し、その後は1年ごとに付与する(出勤率8割以上が条件。ここでは満たしているものとして扱う)
// - 週の所定労働日数が4日以下の人は比例付与(週30時間以上働く人は5日と同じ扱いなので、週5日として登録する)
// - 付与した日から2年で時効
// - 1回に10日以上付与された人は、付与日から1年以内に5日取らせる義務がある

// 勤続 0.5年, 1.5年, 2.5年, 3.5年, 4.5年, 5.5年, 6.5年以上 の付与日数
const GRANT_TABLE: Record<number, number[]> = {
  5: [10, 11, 12, 14, 16, 18, 20],
  4: [7, 8, 9, 10, 12, 13, 15],
  3: [5, 6, 6, 8, 9, 10, 11],
  2: [3, 4, 4, 5, 6, 6, 7],
  1: [1, 2, 2, 2, 3, 3, 3],
};

export const EXPIRE_YEARS = 2;
export const OBLIGATION_HALF_DAYS = 10; // 年5日
export const OBLIGATION_MIN_GRANT = 20; // 10日以上付与された人が対象

export function addMonths(date: Date, months: number) {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + months;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(date.getUTCDate(), last)));
}

export function grantDays(weeklyDays: number, index: number) {
  const row = GRANT_TABLE[Math.min(5, Math.max(1, weeklyDays))];
  return row[Math.min(index, row.length - 1)];
}

// 入社日から today までに付与される日(と日数)。時効で消えたものは含めない。
export function grantSchedule(hireDate: Date, weeklyDays: number, today: Date) {
  const grants: { grantDate: Date; halfDays: number }[] = [];
  for (let i = 0; ; i++) {
    const grantDate = addMonths(hireDate, 6 + 12 * i);
    if (grantDate > today) break;
    if (addMonths(grantDate, 12 * EXPIRE_YEARS) > today) grants.push({ grantDate, halfDays: grantDays(weeklyDays, i) * 2 });
  }
  return grants;
}

// 次に付与される日と日数
export function nextGrant(hireDate: Date, weeklyDays: number, today: Date) {
  for (let i = 0; i < 100; i++) {
    const grantDate = addMonths(hireDate, 6 + 12 * i);
    if (grantDate > today) return { grantDate, halfDays: grantDays(weeklyDays, i) * 2 };
  }
  return null;
}

export type GrantIn = { id: string; grantDate: Date; halfDays: number };
export type TakenIn = { id: string; date: Date; halfDays: number };

// 古い付与から順に使う(先に時効になる分から消化する)。使えた付与がないぶんは shortage に入る。
export function allocate(grants: GrantIn[], taken: TakenIn[]) {
  const pool = [...grants]
    .sort((a, b) => a.grantDate.getTime() - b.grantDate.getTime())
    .map((g) => ({ ...g, expires: addMonths(g.grantDate, 12 * EXPIRE_YEARS), remaining: g.halfDays }));
  const shortage = new Map<string, number>();
  for (const t of [...taken].sort((a, b) => a.date.getTime() - b.date.getTime())) {
    let need = t.halfDays;
    for (const g of pool) {
      if (need === 0) break;
      if (g.grantDate <= t.date && t.date < g.expires && g.remaining > 0) {
        const use = Math.min(need, g.remaining);
        g.remaining -= use;
        need -= use;
      }
    }
    if (need > 0) shortage.set(t.id, need);
  }
  return { pool, shortage };
}

export function balanceOn(pool: ReturnType<typeof allocate>["pool"], day: Date) {
  return pool.filter((g) => g.grantDate <= day && day < g.expires).reduce((s, g) => s + g.remaining, 0);
}

// 年5日の取得義務: 10日以上付与された付与ごとに、1年以内に取った日数を数える
export function obligations(grants: GrantIn[], taken: TakenIn[], today: Date) {
  return grants
    .filter((g) => g.halfDays >= OBLIGATION_MIN_GRANT)
    .map((g) => {
      const end = addMonths(g.grantDate, 12);
      const used = taken.filter((t) => t.date >= g.grantDate && t.date < end).reduce((s, t) => s + t.halfDays, 0);
      return { grantDate: g.grantDate, deadline: new Date(end.getTime() - 86_400_000), used, met: used >= OBLIGATION_HALF_DAYS, ended: end <= today };
    })
    // 期間中のものと、終わってから90日以内の未達のものだけ見せる
    .filter((o) => !o.ended || (!o.met && today.getTime() - o.deadline.getTime() <= 90 * 86_400_000));
}

export const days = (halfDays: number) => halfDays / 2;
export function formatDays(halfDays: number) {
  return `${halfDays % 2 === 0 ? halfDays / 2 : (halfDays / 2).toFixed(1)}日`;
}

import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { aiFor } from "@/lib/ai/access";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { formatYen } from "@/lib/format";
import { collectDays, getMonthlyPayroll, payDays } from "@/lib/shifts/service";

// 人件費の分析: 月ごとの売上・粗利(売上 − 売上原価)・人件費(給料手当・賞与・法定福利費の仕訳)から、
// 人件費率(人件費 ÷ 売上)・労働分配率(人件費 ÷ 粗利)と、シフト・打刻の勤務時間から人時売上高(売上 ÷ 勤務時間)を出す。
// スタッフごとの勤務時間・残業・深夜、曜日ごとの1時間あたりの売上(日ごとの売上の記帳があるとき)も出し、
// AIが使えるときは、シフトの組み方・人件費の見直しの見立てを書く。何も保存しない。

const MODEL = process.env.ANTHROPIC_ASSISTANT_MODEL || "claude-opus-5-5";
const DAILY_LIMIT = Number(process.env.ASSISTANT_DAILY_LIMIT || 100);
const POSTED = ["AUTO_POSTED", "POSTED_MANUALLY"] as const;
const LABOR = ["5110", "5115", "5120"];
const COST_OF_SALES = "5000";
const WEEKDAYS = "日月火水木金土";
// 36協定の時間外労働の上限(原則): 月45時間
const OVERTIME_LIMIT = 45 * 60;

const addMonths = (month: string, n: number) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
};
const pctOf = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

export async function getLaborAnalysis(companyId: string, monthInput?: string | null, now = new Date()) {
  const today = jstDateKey(now);
  const thisMonth = today.slice(0, 7);
  const months = Array.from({ length: 6 }, (_, i) => addMonths(thisMonth, i - 6));
  const lines = await prisma.journalLine.findMany({
    where: { account: { category: { in: ["REVENUE", "EXPENSE"] } }, journalEntry: { companyId, status: { in: [...POSTED] }, sourceType: { not: "OPENING" }, date: { gte: new Date(`${months[0]}-01T00:00:00Z`), lt: new Date(`${thisMonth}-01T00:00:00Z`) } } },
    select: { debit: true, credit: true, account: { select: { code: true, category: true } }, journalEntry: { select: { date: true } } },
  });
  const payrolls = await Promise.all(months.map((m) => getMonthlyPayroll(companyId, m)));

  const monthly = months.map((month, i) => {
    const mine = lines.filter((l) => l.journalEntry.date.toISOString().startsWith(month));
    const revenue = mine.filter((l) => l.account.category === "REVENUE").reduce((s, l) => s + l.credit - l.debit, 0);
    const costOfSales = mine.filter((l) => l.account.code === COST_OF_SALES).reduce((s, l) => s + l.debit - l.credit, 0);
    const laborBooked = mine.filter((l) => LABOR.includes(l.account.code)).reduce((s, l) => s + l.debit - l.credit, 0);
    const p = payrolls[i];
    const minutes = p.rows.reduce((s, r) => s + r.workMinutes, 0);
    const overtime = p.rows.reduce((s, r) => s + r.overtimeMinutes, 0);
    // 人件費は仕訳(給料の計上)を使い、まだ計上していない月はシフト・打刻から出した支給額で見る
    const labor = laborBooked > 0 ? laborBooked : p.total;
    const gross = revenue - costOfSales;
    const hours = Math.round(minutes / 6) / 10;
    return {
      month,
      revenue,
      gross,
      labor,
      laborSource: laborBooked > 0 ? ("booked" as const) : p.total > 0 ? ("shifts" as const) : ("none" as const),
      laborRatio: pctOf(labor, revenue),
      laborShare: pctOf(labor, gross),
      hours,
      overtimeHours: Math.round(overtime / 6) / 10,
      salesPerHour: minutes > 0 && revenue > 0 ? Math.round(revenue / (minutes / 60)) : null,
      grossPerHour: minutes > 0 && gross > 0 ? Math.round(gross / (minutes / 60)) : null,
    };
  });

  // スタッフごと(指定の月、なければ勤務のある直近の月。今月も選べる)
  const candidates = [thisMonth, ...[...months].reverse()];
  const month = monthInput && /^\d{4}-(0[1-9]|1[0-2])$/.test(monthInput) ? monthInput : (candidates.find((m, i) => (i === 0 ? false : payrolls[months.indexOf(m)]?.rows.some((r) => r.workMinutes > 0))) ?? thisMonth);
  const payroll = months.includes(month) ? payrolls[months.indexOf(month)] : await getMonthlyPayroll(companyId, month);
  const staff = payroll.rows
    .filter((r) => r.workMinutes > 0 || r.leaveHalfDays > 0)
    .map((r) => ({
      staffId: r.staffId,
      name: r.name,
      hourlyWage: r.hourlyWage,
      days: r.actualDays + r.plannedDays,
      hours: Math.round(r.workMinutes / 6) / 10,
      overtimeHours: Math.round(r.overtimeMinutes / 6) / 10,
      nightHours: Math.round(r.nightMinutes / 6) / 10,
      pay: r.total,
      overLimit: r.overtimeMinutes > OVERTIME_LIMIT,
      nearLimit: r.overtimeMinutes > OVERTIME_LIMIT * 0.8 && r.overtimeMinutes <= OVERTIME_LIMIT,
    }))
    .sort((a, b) => b.hours - a.hours);

  // 曜日ごとの1時間あたりの売上(直近8週。日ごとの売上の記帳が15日以上あるときだけ)
  const to = new Date(`${today}T00:00:00Z`);
  const from = new Date(to.getTime() - 56 * 86_400_000);
  const [salesLines, period] = await Promise.all([
    prisma.journalLine.findMany({
      where: { account: { category: "REVENUE" }, journalEntry: { companyId, status: { in: [...POSTED] }, sourceType: { not: "OPENING" }, date: { gte: from, lt: to } } },
      select: { debit: true, credit: true, journalEntry: { select: { date: true } } },
    }),
    collectDays(companyId, { gte: from, lt: to }),
  ]);
  const salesByDate = new Map<string, number>();
  for (const l of salesLines) {
    const d = jstDateKey(l.journalEntry.date);
    salesByDate.set(d, (salesByDate.get(d) ?? 0) + l.credit - l.debit);
  }
  const minutesByDate = new Map<string, number>();
  const pays = payDays(period.days);
  for (const [key, day] of period.days) {
    if (!period.inRange(day.date)) continue;
    minutesByDate.set(day.date, (minutesByDate.get(day.date) ?? 0) + (pays.get(key)?.workMinutes ?? 0));
  }
  const dailySales = salesByDate.size >= 15;
  const weekdays = dailySales
    ? Array.from({ length: 7 }, (_, wd) => {
        const dates = [...new Set([...salesByDate.keys(), ...minutesByDate.keys()])].filter((d) => new Date(`${d}T00:00:00Z`).getUTCDay() === wd);
        const sales = dates.reduce((s, d) => s + (salesByDate.get(d) ?? 0), 0);
        const minutes = dates.reduce((s, d) => s + (minutesByDate.get(d) ?? 0), 0);
        return { weekday: WEEKDAYS[wd], days: dates.length, salesPerDay: dates.length ? Math.round(sales / dates.length) : 0, hoursPerDay: dates.length ? Math.round(minutes / dates.length / 6) / 10 : 0, salesPerHour: minutes > 0 ? Math.round(sales / (minutes / 60)) : null };
      })
    : [];

  const findings: string[] = [];
  const done = monthly.filter((m) => m.revenue > 0);
  const last = done[done.length - 1];
  const earlier = done.slice(0, -1).slice(-3);
  if (last) {
    findings.push(`${Number(last.month.slice(5))}月の人件費は ${formatYen(last.labor)}、人件費率 ${last.laborRatio ?? "-"}%・労働分配率 ${last.laborShare ?? "-"}% です。`);
    const avgRatio = earlier.length ? earlier.reduce((s, m) => s + (m.laborRatio ?? 0), 0) / earlier.length : null;
    if (avgRatio !== null && last.laborRatio !== null && last.laborRatio - avgRatio >= 3) findings.push(`人件費率が、その前の${earlier.length}か月の平均(${Math.round(avgRatio * 10) / 10}%)より ${Math.round((last.laborRatio - avgRatio) * 10) / 10}ポイント上がっています。`);
    if (last.salesPerHour !== null) findings.push(`1時間あたりの売上(人時売上高)は ${formatYen(last.salesPerHour)} です(シフト・打刻の勤務 ${last.hours}時間)。`);
  } else findings.push("直近6か月の売上の記帳がないため、比べられません。");
  const over = staff.filter((s) => s.overLimit);
  if (over.length) findings.push(`${Number(month.slice(5))}月に残業が月45時間を超えた人: ${over.map((s) => `${s.name}(${s.overtimeHours}時間)`).join("、")}。36協定の上限(原則)を超えています。`);
  const near = staff.filter((s) => s.nearLimit);
  if (near.length) findings.push(`残業が月45時間に近い人: ${near.map((s) => `${s.name}(${s.overtimeHours}時間)`).join("、")}`);
  if (weekdays.length) {
    const ranked = weekdays.filter((w) => w.salesPerHour !== null).sort((a, b) => a.salesPerHour! - b.salesPerHour!);
    if (ranked.length >= 2) findings.push(`1時間あたりの売上がいちばん低いのは${ranked[0].weekday}曜日(${formatYen(ranked[0].salesPerHour!)})、高いのは${ranked[ranked.length - 1].weekday}曜日(${formatYen(ranked[ranked.length - 1].salesPerHour!)})です。`);
  }
  return { months: monthly, month, staff, weekdays, dailySales, findings };
}

const SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "人件費の見立て(2〜3文)" },
    points: { type: "array", items: { type: "string" }, description: "シフトの組み方・人件費について考えるとよいこと(各1文、5つまで)" },
  },
  required: ["summary", "points"],
  additionalProperties: false,
};

export async function adviseLabor(user: { id: string; companyId: string }, monthInput?: string | null) {
  const r = await getLaborAnalysis(user.companyId, monthInput);
  const ai = await aiFor(user.companyId);
  if (!ai) throw new UserError("AIが使えません(AIの設定を確かめてください)");
  const today = jstDateKey(new Date());
  if ((await prisma.assistantLog.count({ where: { companyId: user.companyId, createdAt: { gte: new Date(`${today}T00:00:00+09:00`) } } })) >= DAILY_LIMIT) throw new UserError(`AIの利用は1日${DAILY_LIMIT}回までです。明日またお試しください`);
  let summary: string | null = null;
  let points: string[] = [];
  try {
    const response = await ai.beta.messages.create({
      model: MODEL,
      max_tokens: 3000,
      system: [
        {
          type: "text",
          text: [
            "あなたは小さなお店・会社の店長の右腕です。月ごとの人件費・人件費率・労働分配率・人時売上高、スタッフごとの勤務時間と残業、曜日ごとの1時間あたりの売上を読み、短い見立てと、シフトの組み方や人件費について考えるとよいことを書いてください。",
            "残業が月45時間を超えた人がいれば、36協定の上限(原則)を超えていることを必ず挙げてください。人を減らすことだけでなく、忙しい曜日に人を寄せる・暇な時間を減らす・売上を上げる工夫も考えてください。数字は渡したものだけを使い、業界の平均など渡していない数字は使わないでください。",
          ].join("\n"),
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: JSON.stringify({ months: r.months, staffMonth: r.month, staff: r.staff.map(({ staffId: _s, ...s }) => (void _s, s)), weekdays: r.weekdays }) }],
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    if (response.stop_reason !== "refusal" && response.stop_reason !== "max_tokens") {
      const raw = JSON.parse(
        response.content
          .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
          .map((b) => b.text)
          .join(""),
      ) as { summary?: unknown; points?: unknown };
      summary = typeof raw.summary === "string" && raw.summary.trim() ? raw.summary.trim().slice(0, 500) : null;
      points = (Array.isArray(raw.points) ? raw.points : [])
        .filter((p): p is string => typeof p === "string")
        .map((p) => p.trim().slice(0, 200))
        .filter(Boolean)
        .slice(0, 5);
    }
  } catch (error) {
    if (!(error instanceof Anthropic.APIError) && !(error instanceof SyntaxError)) throw error;
  }
  await prisma.assistantLog.create({ data: { companyId: user.companyId, userId: user.id, question: "人件費の分析", tools: [], mode: summary ? "labor-claude" : "labor-template" } });
  if (!summary) throw new UserError("AIの見立てを作れませんでした。時間をおいてもう一度お試しください");
  return { summary, points };
}

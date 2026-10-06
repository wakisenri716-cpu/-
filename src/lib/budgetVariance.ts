import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { aiFor } from "@/lib/ai/access";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { formatYen } from "@/lib/format";
import { getBudgetProgress, type ProgressStatus } from "@/lib/accounting/budgetProgress";

// 予算と実績の差の原因: 予算を超えた・超えそうな費用と、届かなそうな売上について、
// ・どの月が月の予算(年間予算の1/12)から大きく外れたか、記帳のない月はないか
// ・前年の同じ時期と比べて、どの取引(摘要)が増えた・減ったか(前年がなければ、多い取引の内訳)
// ・一度に大きな支払い
// を決まったルールで出し、AIが使えるときは原因の見立てと次の一手を書く(何も保存しない)。

const MODEL = process.env.ANTHROPIC_ASSISTANT_MODEL || "claude-opus-5-5";
const DAILY_LIMIT = Number(process.env.ASSISTANT_DAILY_LIMIT || 100);
const POSTED = ["AUTO_POSTED", "POSTED_MANUALLY"] as const;
const MAX_ITEMS = 10;

const addMonths = (month: string, n: number) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
};
const monthLabel = (m: string) => m.replace("-", "/");

// 摘要から日付・数字・かっこを除いて、同じ種類の取引をまとめる
export function groupKey(description: string) {
  const k = description
    .normalize("NFKC")
    .replace(/\d{2,4}[/年.-]\d{1,2}([/月.-]\d{1,2}日?)?/g, "")
    .replace(/\d{1,2}月分?/g, "")
    .replace(/\d+/g, "")
    .replace(/[\s()()【】[\]「」・,、。:#-]+/g, " ")
    .trim()
    .slice(0, 40);
  return k || "(摘要なし)";
}

export type Driver = { label: string; current: number; previous: number; diff: number; count: number; journalId: string };
export type VarianceItem = {
  accountId: string;
  code: string;
  name: string;
  kind: "REVENUE" | "EXPENSE";
  status: ProgressStatus;
  budget: number;
  pace: number;
  actual: number;
  forecast: number;
  paceGap: number;
  forecastGap: number;
  monthlyBudget: number;
  months: { month: string; amount: number; flag: "HIGH" | "LOW" | "EMPTY" | null; partial: boolean }[];
  basis: "lastYear" | "share";
  drivers: Driver[];
  bigEntries: { journalId: string; date: string; description: string; amount: number }[];
  findings: string[];
  aiCause: string | null;
  aiAction: string | null;
};

export async function getBudgetVariance(companyId: string, fiscalYear?: string | null, today = jstDateKey(new Date())) {
  const p = await getBudgetProgress(companyId, fiscalYear, today);
  const targets = [...p.expense.filter((r) => r.status === "OVER" || r.status === "RISK"), ...p.revenue.filter((r) => r.status === "BEHIND")].slice(0, MAX_ITEMS);
  const base = { year: p.year, current: p.current, months: p.months, elapsed: p.elapsed, checked: p.expense.length + p.revenue.length };
  if (!targets.length || p.elapsed === 0) return { ...base, items: [] as VarianceItem[] };

  const thisMonth = today.slice(0, 7);
  const months = p.months.slice(0, p.elapsed);
  const end = addMonths(months[months.length - 1], 1);
  const lineSelect = { accountId: true, debit: true, credit: true, journalEntry: { select: { id: true, date: true, description: true } } } as const;
  const range = (from: string, to: string) => ({ gte: new Date(`${from}-01T00:00:00Z`), lt: new Date(`${to}-01T00:00:00Z`) });
  const accountIds = targets.map((t) => t.accountId);
  const [lines, prevLines] = await Promise.all([
    prisma.journalLine.findMany({ where: { accountId: { in: accountIds }, journalEntry: { companyId, status: { in: [...POSTED] }, sourceType: { not: "OPENING" }, date: range(months[0], end) } }, select: lineSelect }),
    prisma.journalLine.findMany({ where: { accountId: { in: accountIds }, journalEntry: { companyId, status: { in: [...POSTED] }, sourceType: { not: "OPENING" }, date: range(addMonths(months[0], -12), addMonths(end, -12)) } }, select: lineSelect }),
  ]);
  // 会社全体で記帳のない月(科目ごとの0円の月は、たまにしか出ない費用もあるので見ない)
  const booked = await Promise.all(
    months.map((m) => prisma.journalEntry.findFirst({ where: { companyId, status: { in: [...POSTED] }, sourceType: { not: "OPENING" }, date: range(m, addMonths(m, 1)) }, select: { id: true } })),
  );
  const unbooked = new Set(months.filter((m, i) => !booked[i] && m !== thisMonth));

  const items: VarianceItem[] = targets.map((t) => {
    const kind = t.kind;
    const sign = (l: { debit: number; credit: number }) => (kind === "EXPENSE" ? l.debit - l.credit : l.credit - l.debit);
    const mine = lines.filter((l) => l.accountId === t.accountId);
    const prev = prevLines.filter((l) => l.accountId === t.accountId);
    const budget = t.budget ?? 0;
    const monthlyBudget = Math.round(budget / 12);

    // 月ごと
    const byMonth = new Map<string, number>();
    for (const l of mine) {
      const m = l.journalEntry.date.toISOString().slice(0, 7);
      byMonth.set(m, (byMonth.get(m) ?? 0) + sign(l));
    }
    const monthRows = months.map((month) => {
      const amount = byMonth.get(month) ?? 0;
      const partial = month === thisMonth;
      let flag: VarianceItem["months"][number]["flag"] = null;
      if (unbooked.has(month)) flag = "EMPTY";
      else if (kind === "EXPENSE" && amount > monthlyBudget * 1.25 && amount - monthlyBudget >= 10_000) flag = "HIGH";
      else if (kind === "REVENUE" && !partial && amount < monthlyBudget * 0.8) flag = "LOW";
      return { month, amount, flag, partial };
    });

    // 取引(摘要)ごと: 今期と前年の同じ時期
    const groups = new Map<string, Driver & { latest: number }>();
    const add = (l: (typeof mine)[number], field: "current" | "previous") => {
      const key = groupKey(l.journalEntry.description);
      const g = groups.get(key) ?? { label: l.journalEntry.description, current: 0, previous: 0, diff: 0, count: 0, journalId: l.journalEntry.id, latest: 0 };
      g[field] += sign(l);
      if (field === "current") {
        g.count += 1;
        if (l.journalEntry.date.getTime() >= g.latest) {
          g.latest = l.journalEntry.date.getTime();
          g.label = l.journalEntry.description;
          g.journalId = l.journalEntry.id;
        }
      }
      groups.set(key, g);
    };
    for (const l of mine) add(l, "current");
    for (const l of prev) add(l, "previous");
    const all = [...groups.values()].map(({ latest: _l, ...g }) => (void _l, { ...g, diff: g.current - g.previous }));
    const hasPrevious = prev.length > 0;
    const drivers = hasPrevious
      ? kind === "EXPENSE"
        ? all.filter((g) => g.diff > 0).sort((a, b) => b.diff - a.diff)
        : all.filter((g) => g.diff < 0).sort((a, b) => a.diff - b.diff)
      : all.filter((g) => g.current > 0).sort((a, b) => b.current - a.current);

    // 一度に大きな支払い(費用だけ)
    const bigLine = Math.max(monthlyBudget * 0.5, 50_000);
    const bigEntries =
      kind === "EXPENSE"
        ? mine
            .filter((l) => sign(l) >= bigLine)
            .sort((a, b) => sign(b) - sign(a))
            .slice(0, 3)
            .map((l) => ({ journalId: l.journalEntry.id, date: jstDateKey(l.journalEntry.date), description: l.journalEntry.description, amount: sign(l) }))
        : [];

    const pace = t.pace ?? 0;
    const forecast = t.forecast ?? 0;
    const paceGap = kind === "EXPENSE" ? t.actual - pace : pace - t.actual;
    const forecastGap = kind === "EXPENSE" ? forecast - budget : budget - forecast;

    // 決まったルールでの説明
    const findings: string[] = [];
    if (kind === "EXPENSE") {
      findings.push(
        t.status === "OVER"
          ? `年間予算 ${formatYen(budget)} を、すでに ${formatYen(t.actual - budget)} 超えています。`
          : `今月までの予算 ${formatYen(pace)} に対して実績 ${formatYen(t.actual)}${paceGap > 0 ? `(${formatYen(paceGap)} 多い)` : ""}。このペースだと年間で ${formatYen(forecastGap)} 超えます。`,
      );
      const high = monthRows.filter((m) => m.flag === "HIGH");
      if (high.length) findings.push(`月の予算(${formatYen(monthlyBudget)})を大きく上回った月: ${high.map((m) => `${monthLabel(m.month)}(${formatYen(m.amount)})`).join("、")}`);
    } else {
      findings.push(`今月までの予算 ${formatYen(pace)} に対して実績 ${formatYen(t.actual)}${paceGap > 0 ? `(${formatYen(paceGap)} 足りない)` : ""}。このペースだと年間で ${formatYen(forecastGap)} 届きません。`);
      const low = monthRows.filter((m) => m.flag === "LOW");
      if (low.length) findings.push(`月の予算(${formatYen(monthlyBudget)})を大きく下回った月: ${low.map((m) => `${monthLabel(m.month)}(${formatYen(m.amount)})`).join("、")}`);
    }
    const empty = monthRows.filter((m) => m.flag === "EMPTY");
    if (empty.length) findings.push(`会社全体で記帳のない月があります: ${empty.map((m) => monthLabel(m.month)).join("、")}(記帳もれなら、それが差の原因です。記帳を始める前の月なら、着地見込みが実際より少なめに出ます)`);
    const top = drivers.slice(0, 3);
    if (top.length) {
      if (hasPrevious)
        findings.push(
          `前年の同じ時期より${kind === "EXPENSE" ? "増えた" : "減った"}主な取引: ${top
            .map((d) => `「${d.label}」${d.diff > 0 ? "+" : "−"}${formatYen(Math.abs(d.diff))}${d.previous === 0 ? "(今期から)" : d.current <= 0 ? "(今期はなし)" : ""}`)
            .join("、")}`,
        );
      else if (t.actual > 0) findings.push(`多い取引: ${top.map((d) => `「${d.label}」${formatYen(d.current)}(${Math.round((d.current / t.actual) * 100)}%)`).join("、")}(前年の同じ時期の記帳がないので、内訳で見ています)`);
    }
    if (bigEntries.length) findings.push(`一度に大きな支払い: ${bigEntries.map((e) => `${e.date.slice(5).replace("-", "/")}「${e.description}」${formatYen(e.amount)}`).join("、")}`);

    return {
      accountId: t.accountId,
      code: t.code,
      name: t.name,
      kind,
      status: t.status,
      budget,
      pace,
      actual: t.actual,
      forecast,
      paceGap,
      forecastGap,
      monthlyBudget,
      months: monthRows,
      basis: hasPrevious ? "lastYear" : "share",
      drivers: drivers.slice(0, 5),
      bigEntries,
      findings,
      aiCause: null,
      aiAction: null,
    };
  });
  return { ...base, items };
}

const SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "全体の見立て(2〜3文)" },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "integer" },
          cause: { type: "string", description: "差が出た原因の見立て(1〜2文)" },
          action: { type: "string", description: "次にやるとよいこと(1文)" },
        },
        required: ["index", "cause", "action"],
        additionalProperties: false,
      },
    },
  },
  required: ["summary", "items"],
  additionalProperties: false,
};

export async function explainBudgetVariance(user: { id: string; companyId: string }, input: { fiscalYear?: unknown; useAi?: unknown }) {
  const companyId = user.companyId;
  const r = await getBudgetVariance(companyId, input.fiscalYear ? String(input.fiscalYear) : null);
  const over = r.items.filter((i) => i.kind === "EXPENSE").length;
  const behind = r.items.length - over;
  let summary = r.items.length
    ? `予算から外れている科目は ${r.items.length}件(費用 ${over}件・売上 ${behind}件)です。月ごとの金額と、増えた・減った取引から原因を確かめてください。`
    : "予算から大きく外れている科目はありません。";
  let mode: "claude" | "template" = "template";
  const ai = input.useAi === false || !r.items.length ? null : await aiFor(companyId);
  if (ai) {
    const today = jstDateKey(new Date());
    if ((await prisma.assistantLog.count({ where: { companyId, createdAt: { gte: new Date(`${today}T00:00:00+09:00`) } } })) >= DAILY_LIMIT) throw new UserError(`AIの利用は1日${DAILY_LIMIT}回までです。明日またお試しください`);
    try {
      const response = await ai.beta.messages.create({
        model: MODEL,
        max_tokens: 6000,
        system: [
          {
            type: "text",
            text: [
              "あなたは日本の小さな会社の経理担当者で、社長に「予算と実績の差の原因」を説明します。",
              "科目ごとに、月ごとの金額(months。flag: HIGH=月の予算を大きく上回った, LOW=大きく下回った, EMPTY=会社全体で記帳がない, partial=今月で途中)、前年の同じ時期と比べて増えた/減った取引(drivers。basis が share なら前年がないので内訳)、一度に大きな支払い(bigEntries)を渡します。",
              "それぞれ、差が出た原因の見立て(cause)と、次にやるとよいこと(action。例: 記帳もれを確かめる、一時的な支出なら予算はそのまま、続くなら予算を見直す、値上げの交渉、売上の打ち手)を短く書いてください。",
              "数字は渡したものだけを使い、作らないでください。記帳のない月があるときは、まず記帳もれの可能性を挙げてください。",
            ].join("\n"),
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [
          {
            role: "user",
            content: JSON.stringify({
              fiscalYear: r.year,
              elapsedMonths: r.elapsed,
              items: r.items.map((i, index) => ({
                index,
                account: i.name,
                kind: i.kind === "EXPENSE" ? "費用" : "売上",
                status: i.status,
                budget: i.budget,
                budgetSoFar: i.pace,
                actual: i.actual,
                forecast: i.forecast,
                months: i.months,
                basis: i.basis,
                drivers: i.drivers.map((d) => ({ label: d.label, current: d.current, previous: d.previous, diff: d.diff, count: d.count })),
                bigEntries: i.bigEntries.map((e) => ({ date: e.date, description: e.description, amount: e.amount })),
              })),
            }),
          },
        ],
        output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
      if (response.stop_reason !== "refusal" && response.stop_reason !== "max_tokens") {
        const raw = JSON.parse(
          response.content
            .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
            .map((b) => b.text)
            .join(""),
        ) as { summary?: unknown; items?: unknown };
        for (const x of Array.isArray(raw.items) ? raw.items : []) {
          const v = x as { index?: unknown; cause?: unknown; action?: unknown };
          const idx = Number(v.index);
          const item = Number.isInteger(idx) ? r.items[idx] : undefined;
          if (!item) continue;
          const cause = String(v.cause ?? "").trim().slice(0, 240);
          const action = String(v.action ?? "").trim().slice(0, 160);
          if (cause) item.aiCause = cause;
          if (action) item.aiAction = action;
        }
        const s = String(raw.summary ?? "").trim().slice(0, 400);
        if (s) summary = s;
        mode = "claude";
      }
    } catch (error) {
      if (!(error instanceof Anthropic.APIError) && !(error instanceof SyntaxError)) throw error;
    }
    await prisma.assistantLog.create({ data: { companyId, userId: user.id, question: "予算と実績の差の原因", tools: [], mode: `variance-${mode}` } });
  }
  return { ...r, summary, mode };
}

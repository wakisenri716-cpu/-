import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { formatYen } from "@/lib/format";
import { getIncomeStatement } from "@/lib/accounting/incomeStatement";
import { getAccountBalances } from "@/lib/accounting/ledger";
import { getAging } from "@/lib/accounting/receivables";
import { cashAccountCodes } from "@/lib/bank/accounts";
import { nextDay } from "@/lib/accounting/period";

// AIの月次レポート: その月の数字をまとめ(facts)、経営者向けのコメントを書く。
// ANTHROPIC_API_KEY があれば Claude が文章を書き、なければ決まった形の文章にする。

const MODEL = process.env.ANTHROPIC_ASSISTANT_MODEL || "claude-opus-5-5";
const DAILY_LIMIT = Number(process.env.ASSISTANT_DAILY_LIMIT || 100);
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

const shift = (ym: string, n: number) => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
const lastDay = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
const rangeOf = (ym: string) => ({ gte: new Date(`${ym}-01T00:00:00Z`), lt: nextDay(lastDay(ym)) });

export function defaultMonth(today = jstDateKey(new Date())) {
  return shift(today.slice(0, 7), -1);
}

export async function buildFacts(companyId: string, month: string) {
  const prev = shift(month, -1);
  const lastYear = shift(month, -12);
  const [cur, pre, ly, codes] = await Promise.all([
    getIncomeStatement(companyId, rangeOf(month)),
    getIncomeStatement(companyId, rangeOf(prev)),
    getIncomeStatement(companyId, rangeOf(lastYear)),
    cashAccountCodes(companyId),
  ]);
  const [endBal, startBal, aging, bigLines] = await Promise.all([
    getAccountBalances(companyId, { lt: nextDay(lastDay(month)) }),
    getAccountBalances(companyId, { lt: new Date(`${month}-01T00:00:00Z`) }),
    getAging(companyId, "ISSUED"),
    prisma.journalLine.findMany({
      where: { debit: { gt: 0 }, account: { companyId, category: "EXPENSE" }, journalEntry: { companyId, status: { in: ["AUTO_POSTED", "POSTED_MANUALLY"] }, date: rangeOf(month) } },
      orderBy: { debit: "desc" },
      take: 3,
      select: { debit: true, account: { select: { name: true } }, journalEntry: { select: { description: true, date: true } } },
    }),
  ]);
  const cash = (list: typeof endBal) => list.filter((b) => codes.includes(b.account.code)).reduce((s, b) => s + b.balance, 0);

  // 科目ごとの前月からの増減(大きい順)
  const rows = (is: typeof cur) => new Map([...is.revenueRows, ...is.expenseRows].map((r) => [r.account.code, { name: r.account.name, category: r.account.category, amount: r.balance }]));
  const a = rows(cur);
  const b = rows(pre);
  const changes = [...new Set([...a.keys(), ...b.keys()])]
    .map((code) => {
      const x = a.get(code) ?? b.get(code)!;
      const now = a.get(code)?.amount ?? 0;
      const before = b.get(code)?.amount ?? 0;
      return { account: x.name, kind: x.category === "REVENUE" ? "収益" : "費用", now, before, change: now - before };
    })
    .filter((c) => Math.abs(c.change) >= 10_000)
    .sort((p, q) => Math.abs(q.change) - Math.abs(p.change))
    .slice(0, 6);

  const overdue = aging.rows.filter((r) => r.overdueDays > 0);
  return {
    month,
    sales: { now: cur.totalRevenue, prevMonth: pre.totalRevenue, sameMonthLastYear: ly.totalRevenue },
    expense: { now: cur.totalExpense, prevMonth: pre.totalExpense, sameMonthLastYear: ly.totalExpense },
    profit: { now: cur.netIncome, prevMonth: pre.netIncome, sameMonthLastYear: ly.netIncome },
    cash: { start: cash(startBal), end: cash(endBal) },
    topExpenses: [...cur.expenseRows].sort((p, q) => q.balance - p.balance).slice(0, 5).map((r) => ({ account: r.account.name, amount: r.balance })),
    biggestChanges: changes,
    largestPayments: bigLines.map((l) => ({ date: jstDateKey(l.journalEntry.date), description: l.journalEntry.description, account: l.account.name, amount: l.debit })),
    receivables: {
      total: aging.total,
      overdueTotal: overdue.reduce((s, r) => s + r.remaining, 0),
      overdueParties: [...new Set(overdue.map((r) => r.partyName))].slice(0, 5),
    },
  };
}

export type Facts = Awaited<ReturnType<typeof buildFacts>>;

const pct = (now: number, before: number) => (before ? `${now >= before ? "+" : ""}${Math.round(((now - before) / Math.abs(before)) * 1000) / 10}%` : "-");
const diff = (now: number, before: number) => `${now >= before ? "+" : "−"}${formatYen(Math.abs(now - before))}`;

// APIキーがないときの決まった形の文章
export function templateReport(f: Facts) {
  const [y, m] = f.month.split("-").map(Number);
  const good: string[] = [];
  const watch: string[] = [];
  if (f.sales.now > f.sales.prevMonth) good.push(`売上が前月より ${diff(f.sales.now, f.sales.prevMonth)}(${pct(f.sales.now, f.sales.prevMonth)})増えました。`);
  else if (f.sales.now < f.sales.prevMonth) watch.push(`売上が前月より ${formatYen(f.sales.prevMonth - f.sales.now)}(${pct(f.sales.now, f.sales.prevMonth)})減りました。`);
  if (f.sales.sameMonthLastYear && f.sales.now > f.sales.sameMonthLastYear) good.push(`前年同月より売上が ${pct(f.sales.now, f.sales.sameMonthLastYear)} 伸びています。`);
  if (f.profit.now < 0) watch.push(`${m}月は ${formatYen(-f.profit.now)} の赤字です。`);
  for (const c of f.biggestChanges.filter((c) => c.kind === "費用" && c.change > 0).slice(0, 2)) watch.push(`${c.account}が前月より ${formatYen(c.change)} 増えました(${formatYen(c.now)})。`);
  for (const c of f.biggestChanges.filter((c) => c.kind === "費用" && c.change < 0).slice(0, 1)) good.push(`${c.account}が前月より ${formatYen(-c.change)} 減りました。`);
  if (f.receivables.overdueTotal > 0) watch.push(`期日を過ぎた未入金が ${formatYen(f.receivables.overdueTotal)} あります(${f.receivables.overdueParties.join("・")})。`);
  if (f.cash.end < f.cash.start) watch.push(`現預金が月初より ${formatYen(f.cash.start - f.cash.end)} 減りました。`);
  else if (f.cash.end > f.cash.start) good.push(`現預金が月初より ${formatYen(f.cash.end - f.cash.start)} 増えました。`);
  const todo: string[] = [];
  if (f.receivables.overdueTotal > 0) todo.push("期日を過ぎた請求書の入金を確かめ、必要なら督促してください。");
  if (watch.some((w) => w.includes("増えました("))) todo.push("増えた費用の中身を確かめ、来月も続くものか見直してください。");
  todo.push("来月の資金繰り予測を確かめてください。");
  return [
    "## まとめ",
    `・${y}年${m}月の売上は ${formatYen(f.sales.now)}、費用は ${formatYen(f.expense.now)}、利益は ${formatYen(f.profit.now)} でした(前月の利益 ${formatYen(f.profit.prevMonth)})。`,
    `・月末の現預金は ${formatYen(f.cash.end)} です。`,
    "## よかったこと",
    ...(good.length ? good.map((g) => `・${g}`) : ["・目立った改善はありませんでした。"]),
    "## 気をつけること",
    ...(watch.length ? watch.map((w) => `・${w}`) : ["・目立った注意点はありません。"]),
    "## 来月やること",
    ...todo.map((t) => `・${t}`),
  ].join("\n");
}

async function claudeReport(companyName: string, f: Facts) {
  const response = await new Anthropic().beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    system: [
      {
        type: "text",
        text: [
          `あなたは「${companyName}」の経営者に、毎月の数字を説明する経理の相談役です。渡された数字(JSON)だけを根拠に、やさしい日本語でレポートを書いてください。`,
          "見出しは「## まとめ」「## よかったこと」「## 気をつけること」「## 来月やること」の4つにし、それぞれ「・」で始まる短い文を2〜4個書いてください。",
          "数字は「1,234,567円」の形で引用し、前月比・前年同月比を使ってください。数字にないことを推測で書かないでください。全体で600字くらいにしてください。",
        ].join("\n"),
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: `${f.month}の数字です。\n${JSON.stringify(f)}` }],
    output_config: { effort: "medium" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  });
  if (response.stop_reason === "refusal") return null;
  const text = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  return text || null;
}

export async function generateMonthlyReport(user: { id: string; name: string; companyId: string }, monthValue: unknown) {
  const month = MONTH.test(String(monthValue ?? "")) ? String(monthValue) : defaultMonth();
  if (month > jstDateKey(new Date()).slice(0, 7)) throw new UserError("これから先の月のレポートは作れません");
  const since = new Date(`${jstDateKey(new Date())}T00:00:00+09:00`);
  if ((await prisma.assistantLog.count({ where: { companyId: user.companyId, createdAt: { gte: since } } })) >= DAILY_LIMIT) {
    throw new UserError(`AIの利用は1日${DAILY_LIMIT}回までです。明日またお試しください`);
  }
  const [facts, company] = await Promise.all([buildFacts(user.companyId, month), prisma.company.findUniqueOrThrow({ where: { id: user.companyId }, select: { name: true } })]);
  let body: string | null = null;
  let mode = "template";
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      body = await claudeReport(company.name, facts);
      if (body) mode = "claude";
    } catch (error) {
      if (!(error instanceof Anthropic.APIError)) throw error;
      // AIに問い合わせできなかったときは決まった形の文章にする
    }
  }
  body ??= templateReport(facts);
  await prisma.assistantLog.create({ data: { companyId: user.companyId, userId: user.id, question: `月次レポート ${month}`, tools: [], mode: `report-${mode}` } });
  return prisma.monthlyReport.upsert({
    where: { companyId_month: { companyId: user.companyId, month } },
    create: { companyId: user.companyId, month, facts, body, mode, createdBy: user.name },
    update: { facts, body, mode, createdBy: user.name, createdAt: new Date() },
  });
}

export async function getMonthlyReports(companyId: string) {
  return prisma.monthlyReport.findMany({ where: { companyId }, orderBy: { month: "desc" }, select: { month: true, mode: true, createdAt: true }, take: 36 });
}

export async function getMonthlyReport(companyId: string, month: string) {
  return prisma.monthlyReport.findUnique({ where: { companyId_month: { companyId, month } } });
}

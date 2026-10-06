import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { aiFor } from "@/lib/ai/access";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { formatYen } from "@/lib/format";
import { getCashflow } from "@/lib/accounting/cashflow";
import { getIncomeStatement } from "@/lib/accounting/incomeStatement";
import { getCollections } from "@/lib/collections";

// AIの資金繰りアドバイス: 資金繰り予測(3か月)・ふだんの毎月の支出・期限を過ぎた未入金・大きな支払を見て、
// 資金が足りなくなる危険の大きさと、効き目(金額)のある打ち手を出す。会社・日ごとに1つ保存する。

const MODEL = process.env.ANTHROPIC_ASSISTANT_MODEL || "claude-opus-5-5";
const DAILY_LIMIT = Number(process.env.ASSISTANT_DAILY_LIMIT || 100);

export type Risk = "LOW" | "MEDIUM" | "HIGH";
export type CashAction = { title: string; detail: string; impact: number | null; href: string };

const addMonths = (month: string, n: number) => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
const ml = (m: string) => `${Number(m.slice(5))}月`;

export async function buildCashFacts(companyId: string, today = jstDateKey(new Date())) {
  const current = today.slice(0, 7);
  const past = [addMonths(current, -3), addMonths(current, -2), addMonths(current, -1)];
  const [flow, collections, ...statements] = await Promise.all([
    getCashflow(companyId, today),
    getCollections(companyId),
    ...past.map((m) => getIncomeStatement(companyId, { gte: new Date(`${m}-01T00:00:00Z`), lt: new Date(`${addMonths(m, 1)}-01T00:00:00Z`) })),
  ]);
  const avgExpense = Math.round(statements.reduce((s, st) => s + st.totalExpense, 0) / statements.length);
  const avgRevenue = Math.round(statements.reduce((s, st) => s + st.totalRevenue, 0) / statements.length);
  const cashNow = flow.months[0]?.opening ?? 0;
  const lowest = flow.months.reduce((lo, m) => (m.closing < lo.closing ? m : lo), flow.months[0]);
  const bigOutflows = flow.months
    .flatMap((m) => m.outflows.map((o) => ({ month: m.month, ...o })))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);
  return {
    today,
    cashNow,
    months: flow.months.map((m) => ({ month: m.month, inflow: m.inflow, outflow: m.outflow, closing: m.closing })),
    shortageMonth: flow.shortage,
    lowest: lowest ? { month: lowest.month, closing: lowest.closing } : null,
    avgMonthlyExpense: avgExpense,
    avgMonthlyRevenue: avgRevenue,
    // 手元の現預金が、ふだんの支出の何か月分あるか
    monthsOfCash: avgExpense > 0 ? Math.round((cashNow / avgExpense) * 10) / 10 : null,
    overdueReceivables: {
      total: collections.total,
      count: collections.rows.length,
      top: collections.rows.slice(0, 5).map((r) => ({ customer: r.customer?.name ?? "", amount: r.remaining, daysOverdue: r.daysOverdue })),
    },
    bigOutflows: bigOutflows.map((o) => ({ month: o.month, label: o.label, amount: o.amount })),
  };
}

export type CashFacts = Awaited<ReturnType<typeof buildCashFacts>>;

export function riskOf(f: CashFacts): Risk {
  if (f.shortageMonth) return "HIGH";
  const safety = f.avgMonthlyExpense;
  if (f.lowest && safety > 0 && f.lowest.closing < safety) return "MEDIUM";
  if (f.monthsOfCash !== null && f.monthsOfCash < 1) return "MEDIUM";
  return "LOW";
}

// APIキーがないときの決まった打ち手
export function templateAdvice(f: CashFacts) {
  const risk = riskOf(f);
  const actions: CashAction[] = [];
  const gap = f.lowest && f.lowest.closing < 0 ? -f.lowest.closing : 0;
  if (f.overdueReceivables.total > 0) {
    const names = f.overdueReceivables.top.slice(0, 3).map((t) => t.customer).join("・");
    actions.push({ title: "期限を過ぎた未入金を回収する", detail: `${names} などから ${formatYen(f.overdueReceivables.total)}(${f.overdueReceivables.count}件)がまだ入金されていません。督促すれば、その分の資金が戻ります。`, impact: f.overdueReceivables.total, href: "/collections" });
  }
  if (risk !== "LOW" && f.bigOutflows.length) {
    const b = f.bigOutflows[0];
    actions.push({ title: "大きな支払の時期を相談する", detail: `${ml(b.month)}の「${b.label}」${formatYen(b.amount)} がいちばん大きな支払です。支払先に分割や時期の相談ができないか確かめましょう。`, impact: b.amount, href: "/receivables?type=payable" });
  }
  if (risk === "HIGH") actions.push({ title: "借入の相談を早めに始める", detail: `${ml(f.shortageMonth!)}末に ${formatYen(gap)} 足りなくなる見込みです。銀行や公的融資の相談は時間がかかるので、早めに動きましょう。`, impact: gap || null, href: "/loans" });
  if (risk !== "LOW") actions.push({ title: "請求の出し忘れがないか確かめる", detail: "終わった仕事の請求書をまだ出していないものがあれば、早く出すほど入金も早まります。", impact: null, href: "/invoices" });
  if (!actions.length) actions.push({ title: "今のところ大きな心配はありません", detail: "毎月、資金繰り予測を見て、大きな支払の前に残高を確かめましょう。", impact: null, href: "/cashflow" });
  const headline =
    risk === "HIGH"
      ? `${ml(f.shortageMonth!)}末に資金が ${formatYen(gap)} 足りなくなる見込みです。すぐに手を打ちましょう。`
      : risk === "MEDIUM"
        ? `${f.lowest ? `${ml(f.lowest.month)}末の残高が ${formatYen(f.lowest.closing)} まで下がり、` : ""}ふだんの1か月分の支出(${formatYen(f.avgMonthlyExpense)})を下回りそうです。`
        : `この3か月は資金に余裕がありそうです${f.monthsOfCash !== null ? `(手元の現預金は支出の約${f.monthsOfCash}か月分)` : ""}。`;
  return { risk, headline, actions: actions.slice(0, 5) };
}

const SCHEMA = {
  type: "object",
  properties: {
    risk: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] },
    headline: { type: "string", description: "経営者への一言(80字以内)" },
    actions: {
      type: "array",
      description: "効き目の大きい順の打ち手(最大5つ)",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "打ち手(25字以内)" },
          detail: { type: "string", description: "なぜ・どれくらい効くか、数字を入れて(100字以内)" },
          impact: { type: ["integer", "null"], description: "資金が良くなる見込みの金額(円)。わからなければ null" },
          href: { type: "string" },
        },
        required: ["title", "detail", "impact", "href"],
        additionalProperties: false,
      },
    },
  },
  required: ["risk", "headline", "actions"],
  additionalProperties: false,
} as const;

const HREFS = new Set(["/collections", "/receivables", "/receivables?type=payable", "/loans", "/invoices", "/cashflow", "/recurring", "/monthly/progress"]);
const RANK: Record<Risk, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };

export async function generateCashAdvice(user: { id: string; name: string; companyId: string }) {
  const companyId = user.companyId;
  const since = new Date(`${jstDateKey(new Date())}T00:00:00+09:00`);
  if ((await prisma.assistantLog.count({ where: { companyId, createdAt: { gte: since } } })) >= DAILY_LIMIT) {
    throw new UserError(`AIの利用は1日${DAILY_LIMIT}回までです。明日またお試しください`);
  }
  const facts = await buildCashFacts(companyId);
  let result = templateAdvice(facts);
  let mode = "template";
  const ai = await aiFor(companyId);
  if (ai) {
    try {
      const response = await ai.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        system: [
          {
            type: "text",
            text: [
              "あなたは小さな会社の経営者に資金繰りを助言する財務の相談役です。渡された数字(JSON)だけを根拠に、資金が足りなくなる危険の大きさ(risk)と、効き目の大きい順の打ち手を書いてください。",
              "risk: 3か月のうちに残高がマイナスになる月があれば HIGH、最も低い月末残高がふだんの1か月分の支出を下回るなら MEDIUM、それ以外は LOW。",
              "打ち手は、未入金の回収・支払時期の相談・請求の早期化・固定費の見直し・借入の相談など、この会社の数字に合うものだけにし、impact には資金が良くなる見込みの金額(わからなければ null)を入れてください。金額は「1,234,567円」の形で書き、数字にないことを推測で書かないでください。",
              `href は ${[...HREFS].join("・")} のどれかだけを使ってください。`,
            ].join("\n"),
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [{ role: "user", content: `今日(${facts.today})の資金の状況です。\n${JSON.stringify(facts)}` }],
        output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
      if (response.stop_reason !== "refusal" && response.stop_reason !== "max_tokens") {
        const text = response.content
          .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
          .map((b) => b.text)
          .join("")
          .trim();
        const raw = JSON.parse(text) as { risk?: unknown; headline?: unknown; actions?: unknown };
        const actions = (Array.isArray(raw.actions) ? raw.actions : [])
          .map((a: { title?: unknown; detail?: unknown; impact?: unknown; href?: unknown }) => ({
            title: String(a?.title ?? "").trim().slice(0, 60),
            detail: String(a?.detail ?? "").trim().slice(0, 240),
            impact: Number.isFinite(Number(a?.impact)) && a?.impact !== null ? Math.round(Number(a.impact)) : null,
            href: HREFS.has(String(a?.href)) ? String(a.href) : "/cashflow",
          }))
          .filter((a) => a.title)
          .slice(0, 5);
        const headline = String(raw.headline ?? "").trim().slice(0, 160);
        if (headline && actions.length) {
          // 危険の大きさは、ルールで決めたものより軽くしない
          const aiRisk = (["LOW", "MEDIUM", "HIGH"] as Risk[]).includes(raw.risk as Risk) ? (raw.risk as Risk) : result.risk;
          result = { risk: RANK[aiRisk] > RANK[result.risk] ? aiRisk : result.risk, headline, actions };
          mode = "claude";
        }
      }
    } catch (error) {
      if (!(error instanceof Anthropic.APIError) && !(error instanceof SyntaxError)) throw error;
    }
  }
  await prisma.assistantLog.create({ data: { companyId, userId: user.id, question: `資金繰りアドバイス ${facts.today}`, tools: [], mode: `cash-${mode}` } });
  return prisma.cashAdvice.upsert({
    where: { companyId_date: { companyId, date: facts.today } },
    create: { companyId, date: facts.today, ...result, facts, mode, createdBy: user.name },
    update: { ...result, facts, mode, createdBy: user.name, createdAt: new Date() },
  });
}

export async function getLatestCashAdvice(companyId: string) {
  return prisma.cashAdvice.findFirst({ where: { companyId }, orderBy: { date: "desc" } });
}

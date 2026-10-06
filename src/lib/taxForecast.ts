import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { aiFor } from "@/lib/ai/access";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { getCorporateTax } from "@/lib/accounting/corporateTax";
import { getMonthlyTable } from "@/lib/accounting/monthly";
import { calcCorporateTax } from "@/lib/accounting/corporateTaxCalc";
import { getCashBalance } from "@/lib/dashboard";
import { SAVING_OPTIONS, applyOptions, parseOptionAmounts } from "@/lib/taxSavingOptions";

// 今期の着地見込みと納税の目安: 今期の実績(終わった月)に、直近3か月の1か月平均 × 残りの月数を足して期末の利益を見込み、
// 法人税等(標準税率の目安)と中間納付を引いた納付額、納付の期限、いまの現預金を出す。
// 決算までにできること(決算賞与・共済・少額の備品・前払い・処分)の金額を入れると、税金とお金の動きがどう変わるかも出す。
// AIが使えるときは、この会社に合いそうなことと注意を書く。何も保存しない。

const MODEL = process.env.ANTHROPIC_ASSISTANT_MODEL || "claude-opus-5-5";
const DAILY_LIMIT = Number(process.env.ASSISTANT_DAILY_LIMIT || 100);
const INCOME_TAX = "5900";

const lastDayAfter = (to: string, months: number) => {
  const [y, m] = to.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + months + 1, 0)).toISOString().slice(0, 10);
};

export async function getTaxForecast(companyId: string, now = new Date()) {
  const today = jstDateKey(now);
  const [tax, table, cash] = await Promise.all([getCorporateTax(companyId), getMonthlyTable(companyId, null), getCashBalance(companyId)]);
  const thisMonth = today.slice(0, 7);
  const months = table.months;
  const expenseMonths = months.map((_, i) => table.expense.filter((r) => r.code !== INCOME_TAX).reduce((s, r) => s + r.months[i], 0));
  const revenueMonths = table.revenueTotal.months;
  const doneIdx = months.map((m, i) => (m < thisMonth ? i : -1)).filter((i) => i >= 0);
  const booked = doneIdx.filter((i) => revenueMonths[i] !== 0 || expenseMonths[i] !== 0);
  // 直近3か月(記帳のある終わった月)の1か月平均
  const recent = booked.slice(-3);
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);
  const runRevenue = avg(recent.map((i) => revenueMonths[i]));
  const runExpense = avg(recent.map((i) => expenseMonths[i]));
  const remaining = months.length - doneIdx.length;
  const actualRevenue = doneIdx.reduce((s, i) => s + revenueMonths[i], 0);
  const actualExpense = doneIdx.reduce((s, i) => s + expenseMonths[i], 0);
  const forecastRevenue = actualRevenue + runRevenue * remaining;
  const forecastExpense = actualExpense + runExpense * remaining;
  const forecastPretax = forecastRevenue - forecastExpense;
  // 交際費は今期の実績を1年分に直す
  const elapsed = Math.max(1, months.length - remaining + (remaining > 0 ? 1 : 0));
  const entertainment = Math.round((tax.base.entertainment * months.length) / Math.min(months.length, elapsed));
  const base = { pretax: forecastPretax, entertainment, capital: tax.base.capital };
  const result = calcCorporateTax(base, tax.input);
  const payable = Math.max(0, result.total - tax.base.interim);
  const findings: string[] = [];
  if (!recent.length) findings.push("今期に記帳の終わった月がまだないため、見込みは出せません。");
  else {
    findings.push(`今期の利益は、このペースだと期末に約 ${yen(forecastPretax)} の見込みです(終わった${doneIdx.length}か月の実績 + 直近${recent.length}か月の平均 × 残り${remaining}か月)。`);
    if (result.total > 0) findings.push(`法人税等の目安は約 ${yen(result.total)}(利益の約${result.rate === null ? "-" : Math.round(result.rate * 100)}%)、中間納付 ${yen(tax.base.interim)} を引いた納付は約 ${yen(payable)} です。期限は ${lastDayAfter(tax.to, 2).replaceAll("-", "/")} です。`);
    else findings.push(`赤字の見込みのため、法人税等は住民税の均等割 約 ${yen(result.perCapita)} だけの目安です。`);
    if (payable > 0 && cash < payable) findings.push(`いまの現預金 ${yen(cash)} では、納付額に足りません。資金の手当てを考えましょう。`);
  }
  return {
    fiscalYear: tax.fiscalYear,
    from: tax.from,
    to: tax.to,
    inProgress: tax.inProgress,
    deadline: lastDayAfter(tax.to, 2),
    months: months.map((m, i) => ({ month: m, revenue: revenueMonths[i], expense: expenseMonths[i], done: m < thisMonth, booked: booked.includes(i) })),
    run: { revenue: runRevenue, expense: runExpense, months: recent.length },
    remaining,
    actual: { revenue: actualRevenue, expense: actualExpense, pretax: actualRevenue - actualExpense },
    forecast: { revenue: forecastRevenue, expense: forecastExpense, pretax: forecastPretax },
    base,
    input: tax.input,
    result,
    interim: tax.base.interim,
    payable,
    cash,
    findings,
    ready: recent.length > 0 && tax.inProgress,
  };
}

const yen = (n: number) => `${n < 0 ? "−" : ""}${Math.abs(Math.round(n)).toLocaleString("ja-JP")}円`;

const SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "着地見込みと納税についての見立て(2〜3文)" },
    points: { type: "array", items: { type: "string" }, description: "決算までに考えるとよいこと・注意(各1文、5つまで)" },
  },
  required: ["summary", "points"],
  additionalProperties: false,
};

export async function adviseTaxForecast(user: { id: string; companyId: string }, input: { amounts?: unknown }) {
  const f = await getTaxForecast(user.companyId);
  if (!f.ready) throw new UserError("今期の見込みを出せる記帳がまだありません");
  const amounts = parseOptionAmounts(input.amounts);
  const effect = applyOptions(f, amounts);
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
            "あなたは日本の中小企業の社長を助ける経理担当者です。今期の利益の着地見込み、法人税等の目安、現預金、決算までにできること(options)の金額と、それを入れたときの税金とお金の動き(effect)を読み、短い見立てと考えるとよいことを書いてください。",
            "大事なこと: 節税のためにお金を使いすぎて資金が足りなくならないこと(税金は減ってもお金は出ていく)、本当に必要な支出だけにすること、制度の条件や期限は会社ごとに違い変わることもあるので、実行前に税理士に確かめること。数字は渡したものだけを使い、制度について渡していないことを断定しないでください。",
          ].join("\n"),
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            fiscalYear: `${f.from}〜${f.to}`,
            remainingMonths: f.remaining,
            forecastPretax: f.forecast.pretax,
            actualPretaxSoFar: f.actual.pretax,
            taxEstimate: f.result.total,
            interimPaid: f.interim,
            payable: f.payable,
            deadline: f.deadline,
            cash: f.cash,
            options: SAVING_OPTIONS.map((o) => ({ title: o.title, detail: o.detail, caution: o.caution, amount: amounts[o.key] })),
            effect,
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
  await prisma.assistantLog.create({ data: { companyId: user.companyId, userId: user.id, question: "着地見込みと納税の目安", tools: [], mode: summary ? "taxforecast-claude" : "taxforecast-template" } });
  if (!summary) throw new UserError("AIの見立てを作れませんでした。時間をおいてもう一度お試しください");
  return { summary, points, effect };
}

import Anthropic from "@anthropic-ai/sdk";
import { inventedNumbers } from "@/lib/ai/numberGuard";
import { prisma } from "@/lib/prisma";
import { aiFor } from "@/lib/ai/access";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { formatYen } from "@/lib/format";
import { getMonthlyTrend } from "@/lib/dashboard";
import { buildSchedule, addMonths, formatRate, METHOD_LABEL, type LoanMethod } from "@/lib/accounting/loanSchedule";
import { listLoans, loanOutflows } from "@/lib/accounting/loans";
import { getBaseline, simulate, type OneTimeItem } from "@/lib/simulation";

// 融資相談の資料: 銀行・信用金庫・日本政策金融公庫に借入を相談するときに持っていく資料の下書き。
// 会社の概要・直近12か月の業績・借入の内容と返済予定表・借りた場合の資金繰り(12か月)・返済の余力の目安を数字で並べ、
// 事業の説明・借入の必要性・返済の見通しの文章を、AI(使えなければ決まった文)で書く。数字はいつも計算で出す。

const MODEL = process.env.ANTHROPIC_ASSISTANT_MODEL || "claude-opus-5-5";
const DAILY_LIMIT = Number(process.env.ASSISTANT_DAILY_LIMIT || 100);
const POSTED = ["AUTO_POSTED", "POSTED_MANUALLY"] as const;

const ym = (m: string) => `${m.slice(0, 4)}年${Number(m.slice(5))}月`;

function parseInput(input: Record<string, unknown>, today: string) {
  const amount = Math.round(Number(String(input.amount ?? "").replaceAll(",", "")));
  if (!Number.isInteger(amount) || amount < 100_000 || amount > 10_000_000_000) throw new UserError("借入額は10万円以上で入力してください");
  const months = Math.round(Number(input.months));
  if (!Number.isInteger(months) || months < 6 || months > 360) throw new UserError("返済期間は6〜360か月で入力してください");
  const rate = Number(input.annualRate ?? 0);
  if (!Number.isFinite(rate) || rate < 0 || rate > 15) throw new UserError("年利は0〜15%で入力してください");
  const grace = Math.round(Number(input.graceMonths ?? 0));
  if (!Number.isInteger(grace) || grace < 0 || grace > 36) throw new UserError("据置期間は0〜36か月で入力してください");
  const method: LoanMethod = input.method === "EQUAL_PRINCIPAL" ? "EQUAL_PRINCIPAL" : "EQUAL_PAYMENT";
  const purpose = String(input.purpose ?? "").trim().slice(0, 1000);
  if (!purpose) throw new UserError("借入の使いみち(何に使うか)を書いてください");
  const useKind = input.useKind === "EQUIPMENT" ? "EQUIPMENT" : "WORKING";
  // 借りる月は来月、返済は据置のあとから
  const borrowMonth = addMonths(today.slice(0, 7), 1);
  return { amount, months, annualRate: Math.round(rate * 1000), grace, method, purpose, useKind, borrowMonth, firstPaymentMonth: addMonths(borrowMonth, grace + 1) };
}

export async function buildLoanApplication(user: { id: string; name: string; companyId: string }, input: Record<string, unknown>) {
  const companyId = user.companyId;
  const today = jstDateKey(new Date());
  const p = parseInput(input, today);
  if (p.grace >= p.months) throw new UserError("据置期間は返済期間より短くしてください");
  const [company, trend, loans, base] = await Promise.all([
    prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { name: true, address: true, representative: true, phone: true, email: true, registrationNumber: true, fiscalYearStartMonth: true } }),
    getMonthlyTrend(companyId, today),
    listLoans(companyId),
    getBaseline(companyId, today),
  ]);
  const past = trend.slice(0, -1);
  if (!past.some((t) => t.revenue || t.expense)) throw new UserError("記帳がまだないので、資料を作れません");
  const from = past[0].month;
  const depreciation = await prisma.journalLine.aggregate({
    where: { account: { companyId, code: "5100" }, journalEntry: { companyId, status: { in: [...POSTED] }, date: { gte: new Date(`${from}-01T00:00:00Z`), lt: new Date(`${today.slice(0, 7)}-01T00:00:00Z`) } } },
    _sum: { debit: true, credit: true },
  });
  const perf = {
    months: past,
    revenue: past.reduce((s, t) => s + t.revenue, 0),
    expense: past.reduce((s, t) => s + t.expense, 0),
    profit: past.reduce((s, t) => s + t.profit, 0),
    depreciation: (depreciation._sum.debit ?? 0) - (depreciation._sum.credit ?? 0),
    bookedMonths: past.filter((t) => t.revenue || t.expense).length,
  };

  // 新しい借入の返済予定表
  // 据置期間は利息だけを払う(元金の返済はそのあと)
  const graceInterest = Math.floor((p.amount * p.annualRate) / 100_000 / 12);
  const graceRows = Array.from({ length: p.grace }, (_, i) => ({ no: 0, month: addMonths(p.borrowMonth, i + 1), date: "", principal: 0, interest: graceInterest, total: graceInterest, balance: p.amount, posted: false }));
  const schedule = [...graceRows, ...buildSchedule({ principal: p.amount, annualRate: p.annualRate, months: p.months - p.grace, method: p.method, firstPaymentMonth: p.firstPaymentMonth, paymentDay: 31 })].map((row, i) => ({ ...row, no: i + 1 }));
  const interestTotal = schedule.reduce((s, r) => s + r.interest, 0);

  // 借りた場合の12か月の資金繰り(シミュレーションの式を使う。いまの借入の返済も入れる)
  const window = Array.from({ length: 12 }, (_, i) => addMonths(base.start, i));
  const idx = (m: string) => window.indexOf(m) + 1;
  const existing = await loanOutflows(companyId, today, window);
  const oneTime: OneTimeItem[] = [
    { label: "新しい借入(入金)", amount: -p.amount, month: 1, cashOnly: true },
    ...schedule.filter((r) => idx(r.month) > 0).flatMap((r) => [
      { label: "新しい借入の元金返済", amount: r.principal, month: idx(r.month), cashOnly: true },
      { label: "新しい借入の利息", amount: r.interest, month: idx(r.month), cashOnly: false },
    ]),
    ...existing.map((e) => ({ label: e.label, amount: e.amount, month: Math.max(1, idx(e.month)), cashOnly: true })),
  ];
  const plan = simulate(base, { revenuePct: 0, items: [], oneTime, notes: [] });
  const months = window.map((m, i) => ({
    month: m,
    revenue: plan.months[i].revenue,
    expense: plan.months[i].expense,
    loanIn: i === 0 ? p.amount : 0,
    repayment: schedule.filter((r) => r.month === m).reduce((s, r) => s + r.total, 0) + existing.filter((e) => e.month === m).reduce((s, e) => s + e.amount, 0),
    cash: plan.months[i].cash,
  }));

  // 返済の余力の目安(1年分): 利益+減価償却費 と、1年目の元金返済
  const capacity = Math.round(((perf.profit + perf.depreciation) / Math.max(1, perf.bookedMonths)) * 12);
  const firstYearPrincipal = schedule.filter((r) => idx(r.month) > 0).reduce((s, r) => s + r.principal, 0);
  const existingRemaining = loans.summary.remaining;
  const existingFirstYear = existing.reduce((s, e) => s + e.amount, 0);
  const indicators = {
    capacity,
    firstYearRepayment: firstYearPrincipal + existingFirstYear,
    coverage: firstYearPrincipal + existingFirstYear > 0 ? capacity / (firstYearPrincipal + existingFirstYear) : null,
    debtAfter: existingRemaining + p.amount,
    // 債務償還年数の目安: (借入の合計 − 現預金) ÷ (利益+減価償却費)
    payback: capacity > 0 ? Math.max(0, existingRemaining + p.amount - base.cash) / capacity : null,
    lowestCash: Math.min(...months.map((m) => m.cash)),
  };

  const loan = { ...p, rateLabel: formatRate(p.annualRate), methodLabel: METHOD_LABEL[p.method], schedule, interestTotal, lastMonth: schedule[schedule.length - 1].month, monthlyPayment: schedule.find((r) => r.principal > 0)?.total ?? 0 };
  const facts = {
    company: company.name,
    purpose: p.purpose,
    kind: p.useKind === "EQUIPMENT" ? "設備資金" : "運転資金",
    amount: p.amount,
    term: `${p.months}か月(据置${p.grace}か月)`,
    rate: loan.rateLabel,
    monthlyPayment: loan.monthlyPayment,
    last12: { revenue: perf.revenue, expense: perf.expense, profit: perf.profit, depreciation: perf.depreciation, bookedMonths: perf.bookedMonths },
    cashNow: base.cash,
    existingLoans: existingRemaining,
    indicators,
  };

  // 文章(決まった文。AIが使えれば書き直す)
  let narrative = {
    overview: `${company.name}は、直近${perf.bookedMonths}か月(記帳のある月)で売上 ${formatYen(perf.revenue)}、利益 ${formatYen(perf.profit)}です。いまの現預金は ${formatYen(base.cash)}、借入の残高は ${formatYen(existingRemaining)} です。`,
    purpose: `${facts.kind}として ${formatYen(p.amount)} を、${p.months}か月(据置${p.grace}か月)・年${loan.rateLabel}でお借りしたいと考えています。使いみち: ${p.purpose}`,
    repayment: indicators.coverage !== null
      ? `返済の原資(利益+減価償却費)は年 ${formatYen(capacity)} の見込みで、1年目の元金返済 ${formatYen(indicators.firstYearRepayment)} の ${indicators.coverage.toFixed(1)} 倍です。借りた場合の12か月の現預金は、いちばん少ない月で ${formatYen(indicators.lowestCash)} の見込みです。`
      : `1年目は据置期間のため元金の返済はありません。借りた場合の12か月の現預金は、いちばん少ない月で ${formatYen(indicators.lowestCash)} の見込みです。`,
    risks: [
      indicators.lowestCash < 0 ? "この計画のままでは現預金が足りなくなる月があります。借入額・返済期間・据置期間を見直してください。" : "",
      capacity <= 0 ? "直近の利益が出ていないため、返済の原資を示す計画(売上の見込み・費用の見直し)をあわせて説明する必要があります。" : "",
      capacity > 0 && indicators.coverage !== null && indicators.coverage < 1 ? `1年目の元金返済(${formatYen(indicators.firstYearRepayment)})が返済の原資(${formatYen(capacity)})を上回ります。返済期間を延ばす・据置期間を設けるなどの相談が必要です。` : "",
    ]
      .filter(Boolean)
      .join(" "),
  };
  let mode: "claude" | "template" = "template";

  const ai = input.useAi === false ? null : await aiFor(companyId);
  if (ai) {
    if ((await prisma.assistantLog.count({ where: { companyId, createdAt: { gte: new Date(`${today}T00:00:00+09:00`) } } })) >= DAILY_LIMIT) throw new UserError(`AIの利用は1日${DAILY_LIMIT}回までです。明日またお試しください`);
    try {
      const response = await ai.beta.messages.create({
        model: MODEL,
        max_tokens: 6000,
        system: [
          {
            type: "text",
            text: [
              "あなたは中小企業の経理責任者で、金融機関に借入を相談するための資料の文章を書きます。担当者が読みやすいよう、簡潔に、事実と数字に基づいて書いてください。",
              "facts の数字は計算済みで正しいものです。数字を変えたり、facts にない事実(取引先名・受注の見込みなど)を作ったりしないでください。使いみち(purpose)に書かれた内容は使ってかまいません。",
              "overview は会社と直近の業績、purpose は借入の目的と必要性、repayment は返済の見通し、risks は気になる点と対策(なければ空)を、それぞれ2〜4文で書きます。",
            ].join("\n"),
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [{ role: "user", content: JSON.stringify(facts) }],
        output_config: {
          effort: "medium",
          format: {
            type: "json_schema",
            schema: {
              type: "object",
              properties: { overview: { type: "string" }, purpose: { type: "string" }, repayment: { type: "string" }, risks: { type: "string" } },
              required: ["overview", "purpose", "repayment", "risks"],
              additionalProperties: false,
            },
          },
        },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
      if (response.stop_reason !== "refusal" && response.stop_reason !== "max_tokens") {
        const raw = JSON.parse(
          response.content
            .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
            .map((b) => b.text)
            .join(""),
        ) as Record<string, unknown>;
        const clean = (v: unknown) => String(v ?? "").trim().slice(0, 800);
        const written = [raw.overview, raw.purpose, raw.repayment, raw.risks].map(clean).join(" ");
        // facts・決まった文にない数字(金額・期間・倍率)を書いていたら使わない
        if (clean(raw.overview) && clean(raw.purpose) && clean(raw.repayment) && !inventedNumbers(written, `${JSON.stringify(facts)} ${JSON.stringify(narrative)}`).length) {
          // 足りなくなる月があるときの注意は、AIの文に関係なく残す
          const ruleRisk = narrative.risks;
          narrative = { overview: clean(raw.overview), purpose: clean(raw.purpose), repayment: clean(raw.repayment), risks: [ruleRisk, clean(raw.risks)].filter(Boolean).join(" ") };
          mode = "claude";
        }
      }
    } catch (error) {
      if (!(error instanceof Anthropic.APIError) && !(error instanceof SyntaxError)) throw error;
    }
    await prisma.assistantLog.create({ data: { companyId, userId: user.id, question: "融資相談の資料", tools: [], mode: `loan-doc-${mode}` } });
  }

  return {
    createdAt: today,
    createdBy: user.name,
    company: { ...company, fiscalLabel: `${company.fiscalYearStartMonth}月始まり` },
    // 記帳を始める前の月(売上・費用とも0)は表に出さない
    performance: (() => {
      const first = perf.months.findIndex((t) => t.revenue || t.expense);
      const shown = perf.months.slice(first);
      return { ...perf, months: shown, from: ym(shown[0].month), to: ym(shown[shown.length - 1].month) };
    })(),
    loan,
    cashPlan: { months, start: base.cash, basis: base.months.map(ym), existingRepayments: existing.length > 0 },
    indicators,
    existingLoans: loans.rows.filter((r) => r.active && !r.done).map((r) => ({ name: r.name, remaining: r.remaining, rate: formatRate(r.annualRate), monthly: r.next?.total ?? 0 })),
    narrative,
    mode,
  };
}

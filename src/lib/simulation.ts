import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { aiFor } from "@/lib/ai/access";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { formatYen } from "@/lib/format";
import { getCashBalance, getMonthlyTrend } from "@/lib/dashboard";

// もしもシミュレーション: 「1人採用したら」「売上が10%減ったら」「200万円の設備を買ったら」のときの、
// これから12か月の利益と現預金の見込みを、いまのまま(基準)と比べる。
// 基準は直近3か月(今月を除く)の売上・費用の平均と、いまの現預金。計算はいつも決まった式で行い、
// AI は文章を条件(売上の増減・毎月の費用・一度だけの出入り)に直すだけ。

const MODEL = process.env.ANTHROPIC_ASSISTANT_MODEL || "claude-opus-5-5";
const DAILY_LIMIT = Number(process.env.ASSISTANT_DAILY_LIMIT || 100);
// 給料に足す会社負担の社会保険料など(目安)
export const EMPLOYER_COST_RATE = 0.15;

export type MonthlyItem = { label: string; monthly: number; from: number };
export type OneTimeItem = { label: string; amount: number; month: number; cashOnly: boolean };
export type Scenario = { revenuePct: number; items: MonthlyItem[]; oneTime: OneTimeItem[]; notes: string[] };

const ym = (month: string) => `${month.slice(0, 4)}年${Number(month.slice(5))}月`;
const shiftMonth = (month: string, n: number) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
};

export async function getBaseline(companyId: string, today = jstDateKey(new Date())) {
  const [trend, cash] = await Promise.all([getMonthlyTrend(companyId, today), getCashBalance(companyId)]);
  // 今月は途中なので除き、直近3か月(記帳のある月だけ)の平均
  const past = trend.slice(0, -1).filter((t) => t.revenue !== 0 || t.expense !== 0).slice(-3);
  const n = past.length || 1;
  return {
    months: past.map((p) => p.month),
    revenue: Math.round(past.reduce((s, p) => s + p.revenue, 0) / n),
    expense: Math.round(past.reduce((s, p) => s + p.expense, 0) / n),
    cash,
    start: shiftMonth(today.slice(0, 7), 1),
  };
}

export type Baseline = Awaited<ReturnType<typeof getBaseline>>;

export function simulate(base: Baseline, s: Scenario) {
  let cashBase = base.cash;
  let cash = base.cash;
  const months = Array.from({ length: 12 }, (_, k) => {
    const i = k + 1;
    const revenue = Math.round(base.revenue * (1 + s.revenuePct / 100));
    const monthly = s.items.filter((it) => it.from <= i).reduce((t, it) => t + it.monthly, 0);
    const once = s.oneTime.filter((o) => o.month === i);
    const expense = base.expense + monthly + once.filter((o) => !o.cashOnly).reduce((t, o) => t + o.amount, 0);
    const profit = revenue - expense;
    const cashOnly = once.filter((o) => o.cashOnly).reduce((t, o) => t + o.amount, 0);
    cash += profit - cashOnly;
    cashBase += base.revenue - base.expense;
    return { month: shiftMonth(base.start, k), revenue, expense, profit, baseProfit: base.revenue - base.expense, cash, baseCash: cashBase };
  });
  const sum = (f: (m: (typeof months)[number]) => number) => months.reduce((t, m) => t + f(m), 0);
  const shortMonth = months.find((m) => m.cash < 0)?.month ?? null;
  const baseShortMonth = months.find((m) => m.baseCash < 0)?.month ?? null;
  const profit = sum((m) => m.profit);
  const baseProfit = sum((m) => m.baseProfit);
  const lowest = months.reduce((lo, m) => (m.cash < lo.cash ? m : lo), months[0]);
  const comments = [
    `12か月の利益は ${formatYen(profit)}(いまのままなら ${formatYen(baseProfit)}、差 ${profit - baseProfit >= 0 ? "+" : "-"}${formatYen(Math.abs(profit - baseProfit))})。`,
    `1年後の現預金は ${formatYen(months[11].cash)}(いまのままなら ${formatYen(months[11].baseCash)})。`,
    shortMonth
      ? `${ym(shortMonth)}に現預金が足りなくなる見込みです。借入・入金の前倒し・支出の見直しを早めに考えてください。`
      : lowest.cash < base.cash
        ? `現預金がいちばん少ないのは ${ym(lowest.month)}末の ${formatYen(lowest.cash)} です(12か月は足ります)。`
        : "現預金は12か月のあいだ、いまより減らない見込みです。",
  ];
  return { months, totals: { profit, baseProfit, endCash: months[11].cash, baseEndCash: months[11].baseCash }, shortMonth, baseShortMonth, comments };
}

// ---------- 文章から条件へ ----------

const man = (v: string) => Math.round(Number(v.replace(/,/g, "")) * 10_000);
const yen = (num: string, unit?: string) => (unit === "万" ? man(num) : Math.round(Number(num.replace(/,/g, ""))));

// 「10月から」→ 来月を1とした何か月目か
function monthOffset(text: string, start: string) {
  const m = /(\d{1,2})\s*月(?:から|に|より|以降)/.exec(text);
  if (!m) return 1;
  const target = Number(m[1]);
  const [, sm] = start.split("-").map(Number);
  return ((target - sm + 12) % 12) + 1;
}

// 決まったルールでの読み取り(読み取れなかった部分は notes に残す)
export function parseScenarioRule(text: string, start: string): Scenario {
  const t = text.normalize("NFKC");
  const s: Scenario = { revenuePct: 0, items: [], oneTime: [], notes: [] };
  for (const sentence of t.split(/[。\n]/).map((x) => x.trim()).filter(Boolean)) {
    const from = monthOffset(sentence, start);
    let m: RegExpExecArray | null;
    if ((m = /売上[がはを]?\s*(\d+(?:\.\d+)?)\s*[%%](?:ほど)?\s*(減|下が|落ち|増|上が|伸び|アップ|ダウン)/.exec(sentence))) {
      s.revenuePct += /減|下が|落ち|ダウン/.test(m[2]) ? -Number(m[1]) : Number(m[1]);
    } else if ((m = /(\d+)\s*(?:名|人)[^、。]*?(?:採用|雇|入社|増員)/.exec(sentence))) {
      const salary = /月給\s*(\d+(?:\.\d+)?)\s*万/.exec(sentence);
      const each = salary ? man(salary[1]) : 250_000;
      const n = Number(m[1]);
      s.items.push({ label: `${n}名採用(月給${each / 10_000}万円+会社負担の社会保険料など${EMPLOYER_COST_RATE * 100}%)`, monthly: Math.round(n * each * (1 + EMPLOYER_COST_RATE)), from });
      if (!salary) s.notes.push("月給が書かれていないので、1人25万円として計算しました");
    } else if ((m = /家賃[がはを]?\s*月?\s*(\d+(?:\.\d+)?)\s*(万)?円?\s*(上が|増|値上げ|下が|減|値下げ)/.exec(sentence))) {
      const v = yen(m[1], m[2]);
      s.items.push({ label: "家賃の変更", monthly: /下が|減|値下げ/.test(m[3]) ? -v : v, from });
    } else if ((m = /(\d+(?:\.\d+)?)\s*(万)?円\s*(?:を|の)?\s*(?:借り|借入|融資)/.exec(sentence))) {
      s.oneTime.push({ label: "借入(入金)", amount: -yen(m[1], m[2]), month: from, cashOnly: true });
    } else if ((m = /(\d+(?:\.\d+)?)\s*(万)?円\s*の\s*(.{1,15}?)\s*(?:を)?\s*(?:購入|買う|買い|導入|かかる|支払)/.exec(sentence))) {
      s.oneTime.push({ label: m[3], amount: yen(m[1], m[2]), month: from, cashOnly: false });
    } else if ((m = /(?:毎月|月)\s*(\d+(?:\.\d+)?)\s*(万)?円\s*(?:の)?\s*(.{1,15}?)\s*(?:が|を)?\s*(増え|増|追加|かかる|上が|減|下が|なくな|やめ|削)/.exec(sentence))) {
      const v = yen(m[1], m[2]);
      s.items.push({ label: m[3] || "毎月の費用", monthly: /減|下が|なくな|やめ|削/.test(m[4]) ? -v : v, from });
    } else {
      s.notes.push(`読み取れませんでした: 「${sentence.slice(0, 40)}」`);
    }
  }
  return s;
}

const SCHEMA = {
  type: "object",
  properties: {
    revenuePct: { type: "number", description: "売上の増減(%)。例: 10%減なら -10" },
    items: {
      type: "array",
      description: "毎月の費用の増減(円/月)。増えるなら正、減るなら負。from は来月を1とした開始の月",
      items: { type: "object", properties: { label: { type: "string" }, monthly: { type: "integer" }, from: { type: "integer" } }, required: ["label", "monthly", "from"], additionalProperties: false },
    },
    oneTime: {
      type: "array",
      description: "一度だけの出入り(円)。出るなら正、入るなら負。借入・返済のように利益に関係しないものは cashOnly を true",
      items: {
        type: "object",
        properties: { label: { type: "string" }, amount: { type: "integer" }, month: { type: "integer" }, cashOnly: { type: "boolean" } },
        required: ["label", "amount", "month", "cashOnly"],
        additionalProperties: false,
      },
    },
    notes: { type: "array", items: { type: "string" }, description: "置いた前提(例: 月給が書かれていないので25万円とした)" },
  },
  required: ["revenuePct", "items", "oneTime", "notes"],
  additionalProperties: false,
};

const clampInt = (v: unknown, min: number, max: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null;
};

// 画面・AIから来た条件を確かめる
export function sanitizeScenario(raw: unknown): Scenario {
  const r = (raw ?? {}) as Record<string, unknown>;
  const pct = Number(r.revenuePct ?? 0);
  if (!Number.isFinite(pct) || pct < -100 || pct > 1000) throw new UserError("売上の増減は -100%〜1000% にしてください");
  const items = (Array.isArray(r.items) ? r.items : []).slice(0, 20).flatMap((x) => {
    const it = x as Record<string, unknown>;
    const monthly = clampInt(it.monthly, -1_000_000_000, 1_000_000_000);
    const from = clampInt(it.from, 1, 12);
    return monthly === null || from === null || monthly === 0 ? [] : [{ label: String(it.label ?? "毎月の費用").slice(0, 60), monthly, from }];
  });
  const oneTime = (Array.isArray(r.oneTime) ? r.oneTime : []).slice(0, 20).flatMap((x) => {
    const o = x as Record<string, unknown>;
    const amount = clampInt(o.amount, -10_000_000_000, 10_000_000_000);
    const month = clampInt(o.month, 1, 12);
    return amount === null || month === null || amount === 0 ? [] : [{ label: String(o.label ?? "一度だけの出入り").slice(0, 60), amount, month, cashOnly: o.cashOnly === true }];
  });
  const notes = (Array.isArray(r.notes) ? r.notes : []).map((n) => String(n).slice(0, 160)).slice(0, 8);
  return { revenuePct: Math.round(pct * 10) / 10, items, oneTime, notes };
}

export async function parseScenario(user: { id: string; companyId: string }, text: string, start: string) {
  const rule = parseScenarioRule(text, start);
  const ai = await aiFor(user.companyId);
  if (!ai) return { scenario: rule, mode: "template" as const };
  const today = jstDateKey(new Date());
  if ((await prisma.assistantLog.count({ where: { companyId: user.companyId, createdAt: { gte: new Date(`${today}T00:00:00+09:00`) } } })) >= DAILY_LIMIT) {
    return { scenario: rule, mode: "template" as const };
  }
  let scenario = rule;
  let mode: "claude" | "template" = "template";
  try {
    const response = await ai.beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      system: [
        {
          type: "text",
          text: [
            "あなたは日本の小さな会社の経理担当者です。社長の「もしも」の文章を、資金繰りの計算に使う条件に直してください。計算はこちらで行うので、数字の条件だけを作ります。",
            `来月(${start})を1として、何か月目からかを from / month に入れます。人を雇うときは、月給に会社負担の社会保険料などとして${EMPLOYER_COST_RATE * 100}%を足した額を毎月の費用にします。`,
            "金額が書かれていないものは、ふつうの目安を置き、その前提を notes に書いてください。借入・返済・出資のように利益に関係しないお金の出入りは cashOnly を true にします。",
          ].join("\n"),
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: JSON.stringify({ text, ruleGuess: rule }) }],
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
      );
      scenario = sanitizeScenario(raw);
      mode = "claude";
    }
  } catch (error) {
    if (!(error instanceof Anthropic.APIError) && !(error instanceof SyntaxError) && !(error instanceof UserError)) throw error;
  }
  await prisma.assistantLog.create({ data: { companyId: user.companyId, userId: user.id, question: "もしもシミュレーション", tools: [], mode: `simulation-${mode}` } });
  return { scenario, mode };
}

// 画面・アシスタント用: 文章(または条件)から計算まで
export async function runSimulation(user: { id: string; companyId: string }, input: { text?: unknown; scenario?: unknown }) {
  const base = await getBaseline(user.companyId);
  if (base.months.length === 0) throw new UserError("記帳のある月がないので、シミュレーションできません");
  let scenario: Scenario;
  let mode: "claude" | "template" | "manual" = "manual";
  if (input.scenario) scenario = sanitizeScenario(input.scenario);
  else {
    const text = String(input.text ?? "").trim().slice(0, 1000);
    if (!text) throw new UserError("「もしも」を書いてください(例: 来月から1人採用、月給25万円)");
    ({ scenario, mode } = await parseScenario(user, text, base.start));
  }
  return { base, scenario, mode, result: simulate(base, scenario) };
}

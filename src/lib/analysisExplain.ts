import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { aiFor } from "@/lib/ai/access";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { formatYen } from "@/lib/format";
import { getAnalysis, type Metric } from "@/lib/accounting/analysis";

// 経営分析の解説: 経営分析の指標(収益性・安全性・効率性)と前年同期との比較を、社長向けにやさしく説明する。
// ・決まったルールで: 目安をクリアした指標・要チェックの指標・前年から大きく動いた指標を拾い、3行のまとめにする
// ・AIで: 数字だけを根拠に、まとめ・良いところ・気をつけるところ(次にやること付き)を書く
// 何も保存しない。

const MODEL = process.env.ANTHROPIC_ASSISTANT_MODEL || "claude-opus-5-5";
const DAILY_LIMIT = Number(process.env.ASSISTANT_DAILY_LIMIT || 100);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const yen = (n: number) => (n < 0 ? `−${formatYen(-n)}` : formatYen(n));
const fmt = (v: number | null, unit: Metric["unit"]) => (v === null ? "-" : `${Math.round(v * 10) / 10}${unit}`);

// 前年から大きく動いたか(%の指標は3ポイント、日数・月数は2割)
function moved(m: Metric) {
  if (m.current === null || m.prior === null) return null;
  const diff = m.current - m.prior;
  const big = m.unit === "%" ? Math.abs(diff) >= 3 : m.prior !== 0 && Math.abs(diff / m.prior) >= 0.2;
  if (!big) return null;
  const better = m.higherIsBetter ? diff > 0 : diff < 0;
  return { diff, better };
}

export type AnalysisExplanation = {
  summary: string[];
  strengths: string[];
  concerns: { text: string; action: string }[];
  mode: "claude" | "template";
};

export function templateExplanation(a: Awaited<ReturnType<typeof getAnalysis>>): AnalysisExplanation {
  const f = a.figures;
  const p = a.prior;
  const pct = (cur: number, pri: number | undefined) => (pri && pri > 0 ? `前年同期より${cur >= pri ? "+" : ""}${Math.round(((cur - pri) / pri) * 1000) / 10}%` : "");
  const summary = [
    `売上高は ${yen(f.sales)}${p ? `(${pct(f.sales, p.sales)})` : ""}、営業利益は ${f.operatingProfit < 0 ? `${yen(f.operatingProfit)}の赤字` : yen(f.operatingProfit)}です。`,
    f.cash < 0
      ? `期末の現預金が ${yen(f.cash)} とマイナスになっています。記帳もれ(入金・開始残高)がないか確かめてください。`
      : `期末の現預金は ${yen(f.cash)} です${a.metrics.find((m) => m.key === "cashMonths")?.current != null ? `(月の売上の約${fmt(a.metrics.find((m) => m.key === "cashMonths")!.current, "か月")}分)` : ""}。`,
  ];
  const checks = a.metrics.filter((m) => m.good && m.current !== null);
  const ok = checks.filter((m) => m.good!(m.current!));
  const ng = checks.filter((m) => !m.good!(m.current!));
  summary.push(ng.length ? `目安を下回っている指標が${ng.length}つあります(${ng.map((m) => m.label).join("・")})。` : "目安のある指標は、すべて目安をクリアしています。");
  const strengths = ok.map((m) => `${m.label}が ${fmt(m.current, m.unit)} で、目安(${m.guide})をクリアしています。`);
  for (const m of a.metrics) {
    const mv = moved(m);
    if (mv?.better) strengths.push(`${m.label}が前年同期の ${fmt(m.prior, m.unit)} から ${fmt(m.current, m.unit)} に良くなっています。`);
  }
  const ACTIONS: Record<string, string> = {
    operatingMargin: "値上げ・原価の見直し・固定費の見直しで、本業のもうけを増やしましょう(値上げの検討・固定費の見直しの画面)。",
    netMargin: "赤字の原因が本業か一時的な費用かを確かめましょう(予算と実績の差の原因の画面)。",
    currentRatio: "支払いの時期と入金の時期を見直し、短期の借入を長期に借り換えることも考えましょう。",
    quickRatio: "売掛金の回収を早め、手元のお金を厚くしましょう(督促・回収の画面)。",
    equityRatio: "利益を残して自己資本を積み上げることと、借入の返済計画の見直しを考えましょう。",
    cashMonths: "手元資金を月の売上の1か月分以上にするため、資金繰り表で入出金を確かめましょう。",
    receivableDays: "入金の遅い取引先を確かめ、請求を早める・支払い条件を相談しましょう(顧客別の採算の画面)。",
  };
  const concerns = ng.map((m) => ({ text: `${m.label}が ${fmt(m.current, m.unit)} で、目安(${m.guide})を下回っています。`, action: ACTIONS[m.key] ?? "税理士などの専門家にも相談しましょう。" }));
  for (const m of a.metrics) {
    const mv = moved(m);
    if (mv && !mv.better && !ng.includes(m)) concerns.push({ text: `${m.label}が前年同期の ${fmt(m.prior, m.unit)} から ${fmt(m.current, m.unit)} に悪くなっています。`, action: ACTIONS[m.key] ?? "原因の科目を損益計算書・貸借対照表で確かめましょう。" });
  }
  return { summary, strengths: strengths.slice(0, 5), concerns: concerns.slice(0, 5), mode: "template" };
}

const SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "array", items: { type: "string" }, description: "社長向けの3行のまとめ(もうけ・お金・全体の調子)" },
    strengths: { type: "array", items: { type: "string" }, description: "良いところ(各1文、3つまで)" },
    concerns: {
      type: "array",
      items: { type: "object", properties: { text: { type: "string" }, action: { type: "string" } }, required: ["text", "action"], additionalProperties: false },
      description: "気をつけるところと次にやること(3つまで)",
    },
  },
  required: ["summary", "strengths", "concerns"],
  additionalProperties: false,
};

const strings = (v: unknown, max: number, len: number) =>
  (Array.isArray(v) ? v : [])
    .filter((s): s is string => typeof s === "string")
    .map((s) => s.trim().slice(0, len))
    .filter(Boolean)
    .slice(0, max);

export async function explainAnalysis(user: { id: string; companyId: string }, input: { from?: unknown; to?: unknown }) {
  const from = String(input.from ?? "");
  const to = String(input.to ?? "");
  if (!DATE.test(from) || !DATE.test(to) || from > to) throw new UserError("期間を正しく選んでください");
  const a = await getAnalysis(user.companyId, { from, to }, jstDateKey(new Date()));
  const base = templateExplanation(a);
  const ai = await aiFor(user.companyId);
  if (!ai) return { ...base, from: a.from, to: a.to };
  const today = jstDateKey(new Date());
  if ((await prisma.assistantLog.count({ where: { companyId: user.companyId, createdAt: { gte: new Date(`${today}T00:00:00+09:00`) } } })) >= DAILY_LIMIT) throw new UserError(`AIの利用は1日${DAILY_LIMIT}回までです。明日またお試しください`);
  let result: AnalysisExplanation = base;
  try {
    const response = await ai.beta.messages.create({
      model: MODEL,
      max_tokens: 3000,
      system: [
        {
          type: "text",
          text: [
            "あなたは小さな会社の社長に、決算書の数字をやさしく説明する経理担当者です。経営分析の数字(売上・利益・現預金と、収益性・安全性・効率性の指標、前年同期の値、一般的な目安)を読み、専門用語をできるだけ使わずに書いてください。",
            "summary は3行(もうけ・お金・全体の調子)。strengths は良いところ、concerns は気をつけるところと、具体的な次にやること(この会社の数字に合うもの)。",
            "数字は渡したものだけを使い、作らないでください。業種の平均など渡していない数字は使わないでください。目安は一般的な水準で、判断に迷うときは税理士に相談するよう促してください。",
          ].join("\n"),
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            period: `${a.from}〜${a.to}`,
            priorPeriod: a.hasPrior ? `${a.priorFrom}〜${a.priorTo}` : null,
            figures: a.figures,
            priorFigures: a.prior,
            metrics: a.metrics.map((m) => ({ name: m.label, group: m.group, unit: m.unit, current: m.current === null ? null : Math.round(m.current * 10) / 10, prior: m.prior === null ? null : Math.round(m.prior * 10) / 10, higherIsBetter: m.higherIsBetter, guide: m.guide, meetsGuide: m.good && m.current !== null ? m.good(m.current) : null })),
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
      ) as { summary?: unknown; strengths?: unknown; concerns?: unknown };
      const summary = strings(raw.summary, 3, 200);
      const strengths = strings(raw.strengths, 3, 200);
      const concerns = (Array.isArray(raw.concerns) ? raw.concerns : [])
        .map((c) => c as { text?: unknown; action?: unknown })
        .filter((c) => typeof c.text === "string" && c.text.trim())
        .map((c) => ({ text: String(c.text).trim().slice(0, 200), action: typeof c.action === "string" ? c.action.trim().slice(0, 200) : "" }))
        .slice(0, 3);
      if (summary.length) result = { summary, strengths, concerns, mode: "claude" };
    }
  } catch (error) {
    if (!(error instanceof Anthropic.APIError) && !(error instanceof SyntaxError)) throw error;
  }
  await prisma.assistantLog.create({ data: { companyId: user.companyId, userId: user.id, question: "経営分析の解説", tools: [], mode: `analysis-${result.mode}` } });
  return { ...result, from: a.from, to: a.to };
}

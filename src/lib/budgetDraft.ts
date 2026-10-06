import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { aiFor } from "@/lib/ai/access";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { formatYen } from "@/lib/format";
import { resolveFiscalYear } from "@/lib/accounting/monthly";

// 予算の下書き: 直近12か月(今月を除く)の実績から、来期(指定の年度)の科目ごとの年間予算の下書きを作る。
// ・決まったルールで: 実績(データが12か月に満たなければ年に直す)× 伸び率。一時的な科目(売却損益・為替差損益・法人税等)は入れない
// ・AIで: 月ごとの実績と、利用者が書いた来期の予定(採用・家賃の値上げ・新しい取引など)を読んで、科目ごとに直し、理由を書く
// 下書きは画面の入力欄に入れるだけで、保存は人が「保存する」を押したとき。

const MODEL = process.env.ANTHROPIC_ASSISTANT_MODEL || "claude-opus-5-5";
const DAILY_LIMIT = Number(process.env.ASSISTANT_DAILY_LIMIT || 100);
const POSTED = ["AUTO_POSTED", "POSTED_MANUALLY"] as const;
// 毎年くり返すとは限らない科目
const ONE_OFF = new Set(["4030", "4040", "5160", "5180", "5900"]);
const ROUND = 1000;

const addMonths = (month: string, n: number) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
};
const round = (n: number) => Math.max(0, Math.round(n / ROUND) * ROUND);

export type DraftRow = {
  accountId: string;
  code: string;
  name: string;
  category: "REVENUE" | "EXPENSE";
  months: number[];
  actual: number;
  rule: number | null;
  amount: number | null;
  reason: string;
  source: "rule" | "ai" | "skip";
};

async function actuals(companyId: string, today: string) {
  const thisMonth = today.slice(0, 7);
  const months = Array.from({ length: 12 }, (_, i) => addMonths(thisMonth, i - 12));
  const [accounts, lines, first] = await Promise.all([
    prisma.account.findMany({ where: { companyId, category: { in: ["REVENUE", "EXPENSE"] } }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true, category: true } }),
    prisma.journalLine.findMany({
      where: { journalEntry: { companyId, status: { in: [...POSTED] }, date: { gte: new Date(`${months[0]}-01T00:00:00Z`), lt: new Date(`${thisMonth}-01T00:00:00Z`) } }, account: { category: { in: ["REVENUE", "EXPENSE"] } } },
      select: { accountId: true, debit: true, credit: true, journalEntry: { select: { date: true, sourceType: true } } },
    }),
    prisma.journalEntry.findFirst({ where: { companyId, status: { in: [...POSTED] }, sourceType: { not: "OPENING" } }, orderBy: { date: "asc" }, select: { date: true } }),
  ]);
  const byAccount = new Map<string, number[]>();
  for (const l of lines) {
    if (l.journalEntry.sourceType === "OPENING") continue;
    const i = months.indexOf(l.journalEntry.date.toISOString().slice(0, 7));
    if (i < 0) continue;
    const row = byAccount.get(l.accountId) ?? Array(12).fill(0);
    row[i] += l.credit - l.debit;
    byAccount.set(l.accountId, row);
  }
  // 記帳を始めてからの月数(12か月に満たなければ、年に直すのに使う)
  const firstMonth = first ? first.date.toISOString().slice(0, 7) : thisMonth;
  const covered = Math.max(1, Math.min(12, months.filter((m) => m >= firstMonth).length));
  return {
    months,
    covered,
    rows: accounts.map((a) => {
      const raw = byAccount.get(a.id) ?? Array(12).fill(0);
      const sign = a.category === "EXPENSE" ? -1 : 1;
      const m = raw.map((v) => v * sign);
      return { accountId: a.id, code: a.code, name: a.name, category: a.category as "REVENUE" | "EXPENSE", months: m, actual: m.reduce((s, v) => s + v, 0) };
    }),
  };
}

export function ruleDraft(rows: Awaited<ReturnType<typeof actuals>>["rows"], covered: number, growth: { revenue: number; expense: number }): DraftRow[] {
  return rows.map((r) => {
    if (r.actual <= 0) return { ...r, rule: null, amount: null, reason: "直近12か月の実績がないので、予算なし", source: "skip" as const };
    if (ONE_OFF.has(r.code)) return { ...r, rule: null, amount: null, reason: "毎年くり返すとは限らない科目なので、予算に入れません(必要なら手で入れてください)", source: "skip" as const };
    const yearly = covered < 12 ? (r.actual / covered) * 12 : r.actual;
    const g = r.category === "REVENUE" ? growth.revenue : growth.expense;
    const amount = round(yearly * (1 + g / 100));
    const basis = covered < 12 ? `実績 ${formatYen(r.actual)}(${covered}か月分)を1年に直して` : `直近12か月の実績 ${formatYen(r.actual)}`;
    return { ...r, rule: amount, amount, reason: `${basis}${g ? ` × ${g > 0 ? "+" : ""}${g}%` : ""}`, source: "rule" as const };
  });
}

const SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "来期の予算の考え方(2〜3文)" },
    adjustments: {
      type: "array",
      items: {
        type: "object",
        properties: { code: { type: "string" }, amount: { type: "integer", description: "年間予算(円)。予算なしにするときは 0" }, reason: { type: "string" } },
        required: ["code", "amount", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["summary", "adjustments"],
  additionalProperties: false,
};

export async function draftBudget(
  user: { id: string; name: string; companyId: string },
  input: { fiscalYear?: unknown; revenueGrowth?: unknown; expenseGrowth?: unknown; plans?: unknown; useAi?: unknown },
) {
  const companyId = user.companyId;
  const fy = await resolveFiscalYear(companyId, input.fiscalYear ? String(input.fiscalYear) : null);
  const pct = (v: unknown) => {
    const n = Number(v ?? 0);
    if (!Number.isFinite(n) || n < -90 || n > 500) throw new UserError("伸び率は -90%〜500% で入れてください");
    return Math.round(n * 10) / 10;
  };
  const growth = { revenue: pct(input.revenueGrowth), expense: pct(input.expenseGrowth) };
  const plans = String(input.plans ?? "").trim().slice(0, 1000);
  const today = jstDateKey(new Date());
  const a = await actuals(companyId, today);
  if (!a.rows.some((r) => r.actual > 0)) throw new UserError("直近12か月の記帳がないので、下書きを作れません。予算は手で入れてください");
  let rows = ruleDraft(a.rows, a.covered, growth);
  let summary = `直近12か月(${a.months[0]}〜${a.months[11]})の実績${a.covered < 12 ? `(記帳のある${a.covered}か月分を1年に直したもの)` : ""}に、売上 ${growth.revenue}%・費用 ${growth.expense}% の伸びを掛けた下書きです。`;
  let mode: "claude" | "template" = "template";

  const ai = input.useAi === false ? null : await aiFor(companyId);
  if (ai) {
    const since = new Date(`${today}T00:00:00+09:00`);
    if ((await prisma.assistantLog.count({ where: { companyId, createdAt: { gte: since } } })) >= DAILY_LIMIT) throw new UserError(`AIの利用は1日${DAILY_LIMIT}回までです。明日またお試しください`);
    try {
      const response = await ai.beta.messages.create({
        model: MODEL,
        max_tokens: 8000,
        system: [
          {
            type: "text",
            text: [
              "あなたは日本の小さな会社の経理担当者で、来期の年間予算(科目ごと)の下書きを作ります。",
              "ruleDraft は直近12か月の実績に伸び率を掛けたものです。月ごとの実績(months、古い順)の季節の波・一時的な大きな支出・増減の傾向と、利用者の来期の予定(plans)を読んで、直したほうがよい科目だけを adjustments に入れてください。",
              "直す理由は具体的に短く(例: 「4月に一度だけのPC購入があったので除く」「2名採用予定で月60万円増」)。根拠のない大きな変更はしないでください。予算をなしにするときは amount を 0 にします。金額は円の整数で、1,000円単位に丸めてください。",
            ].join("\n"),
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [
          {
            role: "user",
            content: JSON.stringify({
              targetFiscalYear: `${fy.year}年度(${fy.months[0]}〜${fy.months[11]})`,
              growth,
              plans: plans || null,
              accounts: rows.filter((r) => r.actual > 0 || r.rule !== null).map((r) => ({ code: r.code, name: r.name, category: r.category === "REVENUE" ? "収益" : "費用", months: r.months, actual: r.actual, ruleDraft: r.rule, note: r.source === "skip" ? r.reason : null })),
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
        ) as { summary?: unknown; adjustments?: unknown };
        const byCode = new Map(rows.map((r) => [r.code, r]));
        for (const x of Array.isArray(raw.adjustments) ? raw.adjustments : []) {
          const adj = x as { code?: unknown; amount?: unknown; reason?: unknown };
          const row = byCode.get(String(adj.code ?? ""));
          const amount = Number(adj.amount);
          const reason = String(adj.reason ?? "").trim().slice(0, 160);
          if (!row || !Number.isFinite(amount) || amount < 0 || !reason) continue;
          // 実績から大きく外れる額(実績の10倍+1,000万円を超える)は使わない
          if (amount > Math.max(row.actual, row.rule ?? 0) * 10 + 10_000_000) continue;
          byCode.set(row.code, { ...row, amount: amount === 0 ? null : round(amount), reason: `AI: ${reason}`, source: "ai" });
        }
        rows = rows.map((r) => byCode.get(r.code)!);
        const s = String(raw.summary ?? "").trim().slice(0, 400);
        if (s) summary = s;
        mode = "claude";
      }
    } catch (error) {
      if (!(error instanceof Anthropic.APIError) && !(error instanceof SyntaxError)) throw error;
    }
    await prisma.assistantLog.create({ data: { companyId, userId: user.id, question: "予算の下書き", tools: [], mode: `budget-${mode}` } });
  }

  const total = (cat: "REVENUE" | "EXPENSE") => rows.filter((r) => r.category === cat).reduce((s, r) => s + (r.amount ?? 0), 0);
  return {
    fiscalYear: fy.year,
    basePeriod: { from: a.months[0], to: a.months[11], covered: a.covered },
    growth,
    summary,
    mode,
    rows: rows.map(({ months: _m, ...r }) => (void _m, r)),
    totals: { revenue: total("REVENUE"), expense: total("EXPENSE"), profit: total("REVENUE") - total("EXPENSE") },
  };
}

import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { aiFor } from "@/lib/ai/access";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { formatYen } from "@/lib/format";

// 顧客の見守り: 発行した請求書から、顧客ごとの変化を見つける。
// ・売上が減っている(直近90日が、その前の90日の6割未満)
// ・注文が途絶えた(前の1年で3か月以上買っていたのに、90日請求がない)
// ・支払いが遅くなってきた(最近の入金の遅れが前より1週間以上長い / 期日を過ぎた請求書が2件以上)
// ・売上が1社に偏っている(直近1年の売上の3割以上)
// ・大きく伸びている(直近90日が前の90日の1.5倍以上) … よい知らせ
// AIは、それぞれの顧客に次にどう動くかを一言で提案する。

const MODEL = process.env.ANTHROPIC_ASSISTANT_MODEL || "claude-opus-5-5";
const DAILY_LIMIT = Number(process.env.ASSISTANT_DAILY_LIMIT || 100);
const DAY = 86_400_000;
const BILLED = ["CONFIRMED", "SENT", "PARTIALLY_PAID", "OVERDUE", "PAID"] as const;
const OPEN = ["CONFIRMED", "SENT", "PARTIALLY_PAID", "OVERDUE"];

export type InsightKind = "DECLINE" | "DORMANT" | "LATE_TREND" | "CONCENTRATION" | "GROWTH";
export type Insight = { customerId: string; name: string; kind: InsightKind; level: "warn" | "info" | "good"; title: string; detail: string; action: string };

export const INSIGHT_LABELS: Record<InsightKind, string> = { DECLINE: "売上が減少", DORMANT: "注文が途絶えた", LATE_TREND: "支払いが遅くなった", CONCENTRATION: "売上の偏り", GROWTH: "大きく伸びた" };

const TEMPLATE_ACTION: Record<InsightKind, string> = {
  DECLINE: "担当者に最近の様子を聞き、困りごとや次の提案のきっかけを探しましょう。",
  DORMANT: "久しぶりの近況伺いの連絡をして、取引が止まった理由を確かめましょう。",
  LATE_TREND: "支払条件を確かめ、与信限度額の見直しや早めの督促を考えましょう。",
  CONCENTRATION: "この顧客が離れると影響が大きいので、関係を大切にしつつ、ほかの顧客も増やしましょう。",
  GROWTH: "お礼を伝え、次の提案をしましょう。売掛金が増えるので与信限度額も確かめましょう。",
};

export async function findCustomerInsights(companyId: string, now = new Date()) {
  const today = jstDateKey(now);
  const t = Date.parse(`${today}T00:00:00Z`);
  const invoices = await prisma.invoice.findMany({
    where: { companyId, direction: "ISSUED", status: { in: [...BILLED] }, customerId: { not: null }, issueDate: { gte: new Date(t - 730 * DAY) } },
    select: { customerId: true, issueDate: true, dueDate: true, subtotalAmount: true, totalAmount: true, status: true, customer: { select: { name: true } }, payments: { select: { paymentDate: true, amount: true } } },
  });
  const by = new Map<string, typeof invoices>();
  for (const inv of invoices) by.set(inv.customerId!, [...(by.get(inv.customerId!) ?? []), inv]);
  const inRange = (d: Date | null, from: number, to: number) => !!d && d.getTime() >= t - from * DAY && d.getTime() < t - to * DAY;
  const yearTotal = invoices.filter((i) => inRange(i.issueDate, 365, -1)).reduce((s, i) => s + i.subtotalAmount, 0);
  const insights: Insight[] = [];

  for (const [customerId, list] of by) {
    const name = list[0].customer?.name ?? "";
    const sum = (from: number, to: number) => list.filter((i) => inRange(i.issueDate, from, to)).reduce((s, i) => s + i.subtotalAmount, 0);
    const recent = sum(90, -1);
    const before = sum(180, 90);
    const year = sum(365, -1);
    const add = (kind: InsightKind, level: Insight["level"], title: string, detail: string) => insights.push({ customerId, name, kind, level, title, detail, action: TEMPLATE_ACTION[kind] });

    if (before >= 100_000 && recent < before * 0.6) {
      add("DECLINE", "warn", `${name}の売上が減っています`, `直近90日 ${formatYen(recent)}(その前の90日は ${formatYen(before)}、${Math.round((1 - recent / before) * 100)}%減)。`);
    } else if (recent >= 100_000 && before > 0 && recent > before * 1.5) {
      add("GROWTH", "good", `${name}の売上が伸びています`, `直近90日 ${formatYen(recent)}(その前の90日は ${formatYen(before)}、${Math.round((recent / before - 1) * 100)}%増)。`);
    }
    const monthsBefore = new Set(list.filter((i) => inRange(i.issueDate, 455, 90)).map((i) => jstDateKey(i.issueDate!).slice(0, 7)));
    if (monthsBefore.size >= 3 && recent === 0) {
      const last = list.map((i) => jstDateKey(i.issueDate!)).sort().pop()!;
      add("DORMANT", "warn", `${name}からの注文が途絶えています`, `前の1年で ${monthsBefore.size}か月 取引がありましたが、最後の請求は ${last} です(90日以上ありません)。`);
    }
    // 入金の遅れ(全額入金済みの請求書で、最後の入金日 − 期日)
    const lateOf = (i: (typeof list)[number]) => (i.dueDate && i.payments.length ? Math.max(0, Math.round((Math.max(...i.payments.map((p) => p.paymentDate.getTime())) - i.dueDate.getTime()) / DAY)) : null);
    const paid = list.filter((i) => i.status === "PAID" && i.dueDate);
    const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : null);
    const recentLate = avg(paid.filter((i) => inRange(i.dueDate, 180, -1)).map(lateOf).filter((x): x is number => x !== null));
    const olderLate = avg(paid.filter((i) => inRange(i.dueDate, 730, 180)).map(lateOf).filter((x): x is number => x !== null));
    const overdue = list.filter((i) => OPEN.includes(i.status) && i.dueDate && i.dueDate.getTime() < t).length;
    if ((recentLate !== null && recentLate >= 10 && recentLate > (olderLate ?? 0) + 7) || overdue >= 2) {
      add(
        "LATE_TREND",
        "warn",
        `${name}の支払いが遅くなっています`,
        [recentLate !== null && recentLate >= 10 ? `最近の入金は期日から平均 ${recentLate}日 遅れ${olderLate !== null ? `(以前は ${olderLate}日)` : ""}。` : "", overdue >= 2 ? `期日を過ぎた請求書が ${overdue}件 あります。` : ""].join(""),
      );
    }
    if (yearTotal > 0 && by.size >= 2 && year / yearTotal >= 0.3) {
      add("CONCENTRATION", "info", `売上の ${Math.round((year / yearTotal) * 100)}% が${name}です`, `直近1年の売上 ${formatYen(yearTotal)} のうち ${formatYen(year)} がこの顧客です。`);
    }
  }
  const rank = { warn: 0, info: 1, good: 2 };
  insights.sort((a, b) => rank[a.level] - rank[b.level]);
  return { today, insights, customers: by.size };
}

const SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "顧客の状況の一言(80字以内)" },
    actions: {
      type: "array",
      items: {
        type: "object",
        properties: { index: { type: "integer", description: "insights の番号(0から)" }, action: { type: "string", description: "次にどう動くか(60字以内)" } },
        required: ["index", "action"],
        additionalProperties: false,
      },
    },
  },
  required: ["summary", "actions"],
  additionalProperties: false,
} as const;

export async function adviseCustomers(user: { id: string; name: string; companyId: string }) {
  const companyId = user.companyId;
  const r = await findCustomerInsights(companyId);
  let summary = r.insights.length ? `気になる顧客の変化が ${r.insights.filter((i) => i.level === "warn").length}件、よい知らせが ${r.insights.filter((i) => i.level === "good").length}件 あります。` : "目立った変化のある顧客はいません。";
  const insights = r.insights.map((i) => ({ ...i }));
  let mode = "template";
  const ai = await aiFor(companyId);
  if (ai && insights.length) {
    const since = new Date(`${r.today}T00:00:00+09:00`);
    if ((await prisma.assistantLog.count({ where: { companyId, createdAt: { gte: since } } })) >= DAILY_LIMIT) throw new UserError(`AIの利用は1日${DAILY_LIMIT}回までです。明日またお試しください`);
    try {
      const response = await ai.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        system: [
          {
            type: "text",
            text: [
              "あなたは小さな会社の営業と経理を手伝う相談役です。顧客ごとの売上・支払いの変化(JSON)を読み、経営者向けに全体の一言と、それぞれの顧客に次にどう動くかを具体的に一言ずつ書いてください。",
              "売上の減少・途絶えには関係を確かめる連絡や提案、支払いの遅れには支払条件や与信の見直し、偏りには依存を減らす工夫、伸びにはお礼と次の提案を考えてください。数字にないことは推測で書かないでください。",
            ].join("\n"),
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [{ role: "user", content: JSON.stringify(insights.map((i, index) => ({ index, customer: i.name, kind: INSIGHT_LABELS[i.kind], detail: i.detail }))) }],
        output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
      if (response.stop_reason !== "refusal" && response.stop_reason !== "max_tokens") {
        const text = response.content
          .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
          .map((b) => b.text)
          .join("")
          .trim();
        const raw = JSON.parse(text) as { summary?: unknown; actions?: unknown };
        for (const a of Array.isArray(raw.actions) ? raw.actions : []) {
          const i = Number((a as { index?: unknown }).index);
          const action = String((a as { action?: unknown }).action ?? "").trim().slice(0, 160);
          if (Number.isInteger(i) && insights[i] && action) insights[i].action = action;
        }
        if (String(raw.summary ?? "").trim()) summary = String(raw.summary).trim().slice(0, 160);
        mode = "claude";
      }
    } catch (error) {
      if (!(error instanceof Anthropic.APIError) && !(error instanceof SyntaxError)) throw error;
    }
    await prisma.assistantLog.create({ data: { companyId, userId: user.id, question: "顧客の見守り", tools: [], mode: `customers-${mode}` } });
  }
  const data = { summary, insights };
  return prisma.aiNote.upsert({
    where: { companyId_kind_key: { companyId, kind: "CUSTOMER_INSIGHTS", key: r.today } },
    create: { companyId, kind: "CUSTOMER_INSIGHTS", key: r.today, data, mode, createdBy: user.name },
    update: { data, mode, createdBy: user.name, createdAt: new Date() },
  });
}

export async function getCustomerAdvice(companyId: string) {
  return prisma.aiNote.findFirst({ where: { companyId, kind: "CUSTOMER_INSIGHTS" }, orderBy: { key: "desc" } });
}

import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { aiFor } from "@/lib/ai/access";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { formatYen } from "@/lib/format";
import { deductibleRate, getTransitionalAdjustment } from "@/lib/accounting/invoiceRegistration";

// 仕入先の見守り: 受け取った請求書と経費から、支払先ごとの変化を見つける。
// ・値上がり(最近3回の1回あたりの金額が、それより前より15%以上・3,000円以上高い)
// ・支払いの急増(直近90日がその前の90日の1.5倍以上・10万円以上)
// ・インボイス登録なし/未確認(控除できない消費税の目安)
// ・支払いの偏り(直近1年の支払いの4割以上が1社)
// ・初めての取引先への大きな支払い(30日以内に初めて・30万円以上)
// AIは、支払先ごとに次にどう動くか(価格交渉・相見積もり・登録の確認など)を一言で提案する。

const MODEL = process.env.ANTHROPIC_ASSISTANT_MODEL || "claude-opus-5-5";
const DAILY_LIMIT = Number(process.env.ASSISTANT_DAILY_LIMIT || 100);
const DAY = 86_400_000;

export type VendorInsightKind = "PRICE_UP" | "SPEND_UP" | "NOT_REGISTERED" | "UNKNOWN_REGISTRATION" | "CONCENTRATION" | "NEW_LARGE";
export type VendorInsight = { vendorId: string; name: string; kind: VendorInsightKind; level: "warn" | "info"; title: string; detail: string; action: string };

export const VENDOR_INSIGHT_LABELS: Record<VendorInsightKind, string> = {
  PRICE_UP: "値上がり",
  SPEND_UP: "支払いが急増",
  NOT_REGISTERED: "インボイス登録なし",
  UNKNOWN_REGISTRATION: "登録が未確認",
  CONCENTRATION: "支払いの偏り",
  NEW_LARGE: "初めての大きな支払い",
};

const TEMPLATE_ACTION: Record<VendorInsightKind, string> = {
  PRICE_UP: "値上げの理由と時期を確かめ、ほかの仕入先の見積もりとも比べましょう。",
  SPEND_UP: "増えた理由(発注量・単価・臨時の購入)を確かめ、予算に合っているか見直しましょう。",
  NOT_REGISTERED: "登録の予定を聞くか、価格に消費税の差を反映してもらえないか相談しましょう。",
  UNKNOWN_REGISTRATION: "請求書の登録番号を確かめて、取引先の画面に入れましょう。",
  CONCENTRATION: "この仕入先が止まると影響が大きいので、代わりの仕入先も探しておきましょう。",
  NEW_LARGE: "契約内容・請求書・登録番号を確かめ、振込先が正しいかも確認しましょう。",
};

export async function findVendorInsights(companyId: string, now = new Date()) {
  const today = jstDateKey(now);
  const t = Date.parse(`${today}T00:00:00Z`);
  const since = new Date(t - 730 * DAY);
  const [invoices, items, vendors, transitional] = await Promise.all([
    prisma.invoice.findMany({
      where: { companyId, direction: "RECEIVED", status: { notIn: ["CANCELLED", "DRAFT"] }, vendorId: { not: null }, OR: [{ issueDate: { gte: since } }, { issueDate: null, createdAt: { gte: since } }] },
      select: { vendorId: true, issueDate: true, createdAt: true, totalAmount: true },
    }),
    prisma.expenseItem.findMany({ where: { expenseReport: { companyId }, vendorId: { not: null }, expenseDate: { gte: since } }, select: { vendorId: true, expenseDate: true, amount: true } }),
    prisma.vendor.findMany({ where: { companyId }, select: { id: true, name: true } }),
    getTransitionalAdjustment(companyId, { gte: new Date(t - 365 * DAY) }),
  ]);
  const names = new Map(vendors.map((v) => [v.id, v.name]));
  const records = [
    ...invoices.map((i) => ({ vendorId: i.vendorId!, date: (i.issueDate ?? i.createdAt).getTime(), amount: i.totalAmount })),
    ...items.map((i) => ({ vendorId: i.vendorId!, date: i.expenseDate.getTime(), amount: i.amount })),
  ].sort((a, b) => a.date - b.date);
  const by = new Map<string, typeof records>();
  for (const r of records) by.set(r.vendorId, [...(by.get(r.vendorId) ?? []), r]);
  const inRange = (d: number, from: number, to: number) => d >= t - from * DAY && d < t - to * DAY;
  const yearTotal = records.filter((r) => inRange(r.date, 365, -1)).reduce((s, r) => s + r.amount, 0);
  const insights: VendorInsight[] = [];
  const add = (vendorId: string, kind: VendorInsightKind, level: VendorInsight["level"], title: string, detail: string) => insights.push({ vendorId, name: names.get(vendorId) ?? "", kind, level, title, detail, action: TEMPLATE_ACTION[kind] });

  for (const [vendorId, list] of by) {
    const name = names.get(vendorId) ?? "";
    const yearList = list.filter((r) => inRange(r.date, 365, -1));
    if (yearList.length >= 5) {
      const last3 = yearList.slice(-3);
      const earlier = yearList.slice(0, -3);
      const avg = (xs: typeof list) => xs.reduce((s, r) => s + r.amount, 0) / xs.length;
      const a = avg(last3);
      const b = avg(earlier);
      if (b > 0 && a >= b * 1.15 && a - b >= 3_000) add(vendorId, "PRICE_UP", "info", `${name}の1回あたりの金額が上がっています`, `最近3回の平均 ${formatYen(Math.round(a))}(それより前は ${formatYen(Math.round(b))}、${Math.round((a / b - 1) * 100)}%高い)。`);
    }
    const sum = (from: number, to: number) => list.filter((r) => inRange(r.date, from, to)).reduce((s, r) => s + r.amount, 0);
    const recent = sum(90, -1);
    const before = sum(180, 90);
    if (recent >= 100_000 && before > 0 && recent >= before * 1.5) add(vendorId, "SPEND_UP", "info", `${name}への支払いが増えています`, `直近90日 ${formatYen(recent)}(その前の90日は ${formatYen(before)})。`);
    const first = list[0];
    if (inRange(first.date, 30, -1)) {
      const total = list.reduce((s, r) => s + r.amount, 0);
      if (total >= 300_000) add(vendorId, "NEW_LARGE", "warn", `初めての取引先 ${name}に大きな支払いがあります`, `30日以内に初めて取引し、${formatYen(total)} の支払いがあります。`);
    }
    const year = yearList.reduce((s, r) => s + r.amount, 0);
    if (yearTotal > 0 && by.size >= 2 && year / yearTotal >= 0.4) add(vendorId, "CONCENTRATION", "info", `支払いの ${Math.round((year / yearTotal) * 100)}% が${name}です`, `直近1年の支払い ${formatYen(yearTotal)} のうち ${formatYen(year)} がこの仕入先です。`);
  }
  // インボイス登録(直近1年の仮払消費税から)
  const rate = deductibleRate(today);
  for (const v of transitional.notRegistered) {
    if (v.tax <= 0) continue;
    add(v.id, "NOT_REGISTERED", "warn", `${v.name}はインボイス登録がありません`, `直近1年の消費税 ${formatYen(v.tax)} のうち、今の経過措置(${Math.round(rate * 100)}%控除)では約 ${formatYen(Math.round(v.tax * (1 - rate)))} が控除できません。`);
  }
  for (const v of transitional.unknown) {
    if (v.tax < 5_000) continue;
    add(v.id, "UNKNOWN_REGISTRATION", "info", `${v.name}のインボイス登録が未確認です`, `直近1年の消費税が ${formatYen(v.tax)} あります。登録がなければ控除が減ります。`);
  }
  const rank = { warn: 0, info: 1 };
  insights.sort((a, b) => rank[a.level] - rank[b.level]);
  return { today, insights, vendors: by.size };
}

const SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "仕入先の状況の一言(80字以内)" },
    actions: {
      type: "array",
      items: { type: "object", properties: { index: { type: "integer" }, action: { type: "string", description: "次にどう動くか(60字以内)" } }, required: ["index", "action"], additionalProperties: false },
    },
  },
  required: ["summary", "actions"],
  additionalProperties: false,
} as const;

export async function adviseVendors(user: { id: string; name: string; companyId: string }) {
  const companyId = user.companyId;
  const r = await findVendorInsights(companyId);
  let summary = r.insights.length ? `気になる仕入先の変化が ${r.insights.length}件 あります(うち要確認 ${r.insights.filter((i) => i.level === "warn").length}件)。` : "目立った変化のある仕入先はありません。";
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
              "あなたは小さな会社の仕入・経費を見直す相談役です。仕入先ごとの変化(JSON)を読み、経営者向けに全体の一言と、それぞれに次にどう動くかを具体的に一言ずつ書いてください。",
              "値上がり・急増には理由の確認と相見積もりや交渉、インボイス登録なしには登録の確認や価格の相談、偏りには代わりの仕入先、初めての大きな支払いには契約・振込先の確認を考えてください。数字にないことは推測で書かないでください。",
            ].join("\n"),
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [{ role: "user", content: JSON.stringify(insights.map((i, index) => ({ index, vendor: i.name, kind: VENDOR_INSIGHT_LABELS[i.kind], detail: i.detail }))) }],
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
    await prisma.assistantLog.create({ data: { companyId, userId: user.id, question: "仕入先の見守り", tools: [], mode: `vendors-${mode}` } });
  }
  const data = { summary, insights };
  return prisma.aiNote.upsert({
    where: { companyId_kind_key: { companyId, kind: "VENDOR_INSIGHTS", key: r.today } },
    create: { companyId, kind: "VENDOR_INSIGHTS", key: r.today, data, mode, createdBy: user.name },
    update: { data, mode, createdBy: user.name, createdAt: new Date() },
  });
}

export async function getVendorAdvice(companyId: string) {
  return prisma.aiNote.findFirst({ where: { companyId, kind: "VENDOR_INSIGHTS" }, orderBy: { key: "desc" } });
}

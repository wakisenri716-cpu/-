import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { aiFor } from "@/lib/ai/access";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { formatYen } from "@/lib/format";
import { closedReason, nextBusinessDay } from "@/lib/holidays";

// 入金予測: 入金待ちの請求書が、期日ではなく「実際にはいつ入りそうか」を、顧客ごとの過去の払い方から見込む。
// ・入金済みの請求書(直近2年)で、期日から何日後に払い終えたか(早いときはマイナス)の中央値を、その顧客のふだんのずれとする
// ・最近3回の平均がふだんより1週間以上遅ければ、最近の遅れを使う
// ・過去の記録が3件未満の顧客は期日どおりと見る(確からしさ: 低)
// ・期日もふだんの遅れも過ぎたものは「1週間後」と見て、督促が必要な目印を付ける
// AIは、払い方の変化や金額の大きさを読んで、遅めに見ておくべき請求書を選ぶ(予測を早めることはできない)。

const MODEL = process.env.ANTHROPIC_ASSISTANT_MODEL || "claude-opus-5-5";
const DAILY_LIMIT = Number(process.env.ASSISTANT_DAILY_LIMIT || 100);
const DAY = 86_400_000;
const OPEN = ["CONFIRMED", "SENT", "PARTIALLY_PAID", "OVERDUE"] as const;
const NOTE_KIND = "RECEIPT_FORECAST";
const NOTE_DAYS = 14; // AIの見直しを使う日数
const MAX_EXTRA = 60;
const AI_ROWS = 40;

export type Confidence = "high" | "medium" | "low";
export type Profile = { count: number; median: number; p80: number; recent: number | null; onTimeRate: number };
export type ReceiptRow = {
  invoiceId: string;
  invoiceNumber: string | null;
  customerId: string | null;
  customer: string;
  remaining: number;
  dueDate: string | null;
  predictedDate: string;
  shiftDays: number;
  confidence: Confidence;
  risk: boolean;
  basis: string;
  aiReason: string | null;
};

export const CONFIDENCE_LABELS: Record<Confidence, string> = { high: "高", medium: "中", low: "低" };

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const diffDays = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY);
const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1) + 0.5))];
};

// 顧客ごとの払い方(期日から何日後に払い終えたか)
export async function paymentProfiles(companyId: string, now = new Date()) {
  const paid = await prisma.invoice.findMany({
    where: { companyId, direction: "ISSUED", status: "PAID", customerId: { not: null }, dueDate: { gte: new Date(now.getTime() - 730 * DAY) } },
    select: { customerId: true, dueDate: true, payments: { select: { paymentDate: true } } },
    orderBy: { dueDate: "asc" },
  });
  const by = new Map<string, number[]>();
  for (const p of paid) {
    if (!p.payments.length || !p.dueDate) continue;
    const late = Math.round((Math.max(...p.payments.map((x) => x.paymentDate.getTime())) - p.dueDate.getTime()) / DAY);
    by.set(p.customerId!, [...(by.get(p.customerId!) ?? []), late]);
  }
  const profiles = new Map<string, Profile>();
  for (const [id, lates] of by) {
    const last3 = lates.slice(-3);
    profiles.set(id, {
      count: lates.length,
      median: quantile(lates, 0.5),
      p80: quantile(lates, 0.8),
      recent: lates.length >= 6 ? Math.round(last3.reduce((s, x) => s + x, 0) / last3.length) : null,
      onTimeRate: lates.filter((x) => x <= 0).length / lates.length,
    });
  }
  return profiles;
}

// 決まったルールでの入金予測
export async function predictReceipts(companyId: string, today = jstDateKey(new Date())) {
  const [invoices, profiles] = await Promise.all([
    prisma.invoice.findMany({
      where: { companyId, direction: "ISSUED", status: { in: [...OPEN] } },
      include: { customer: { select: { id: true, name: true } }, payments: { select: { amount: true } } },
      orderBy: [{ dueDate: "asc" }, { issueDate: "asc" }],
    }),
    paymentProfiles(companyId),
  ]);
  const rows: ReceiptRow[] = [];
  for (const inv of invoices) {
    const remaining = inv.totalAmount - inv.payments.reduce((s, p) => s + p.amount, 0);
    if (remaining <= 0) continue;
    const due = inv.dueDate ? jstDateKey(inv.dueDate) : null;
    const prof = inv.customerId ? profiles.get(inv.customerId) : undefined;
    let offset = 0;
    let confidence: Confidence = "low";
    let basis: string;
    if (prof && prof.count >= 3) {
      offset = prof.median;
      basis = `ふだんは期日から${prof.median > 0 ? `${prof.median}日後` : prof.median < 0 ? `${-prof.median}日前` : "どおり"}に入金(${prof.count}件)`;
      if (prof.recent !== null && prof.recent >= prof.median + 7) {
        offset = prof.recent;
        basis = `最近3回は期日から平均${prof.recent}日後(以前は${prof.median}日)と遅くなっています`;
      }
      offset = Math.max(-30, Math.min(120, offset));
      confidence = prof.count >= 6 && prof.p80 - prof.median <= 10 ? "high" : "medium";
    } else {
      basis = prof ? `入金の記録が少ない(${prof.count}件)ので期日どおりと見ています` : "入金の記録がないので期日どおりと見ています";
    }
    let predicted = due ? addDays(due, offset) : today;
    if (!due) basis = "支払期限がないので、今日入金と見ています";
    let risk = false;
    if (predicted < today) {
      if (due && due < today) {
        const overdue = diffDays(today, due);
        predicted = addDays(today, 7);
        basis = `期日から${overdue}日過ぎ、ふだんの遅れも過ぎています。督促しないと入らないかもしれません`;
        risk = overdue > Math.max(30, (prof?.p80 ?? 0) + 14);
        confidence = "low";
      } else {
        predicted = today;
      }
    }
    // 銀行の休業日(土日・祝日・年末年始)には入金されないので、次の営業日にずらす
    const closed = predicted > today ? closedReason(predicted, "bank") : null;
    if (closed) {
      predicted = nextBusinessDay(predicted, "bank");
      basis += `(${closed}なので次の営業日)`;
    }
    rows.push({
      invoiceId: inv.id,
      invoiceNumber: inv.invoiceNumber,
      customerId: inv.customerId,
      customer: inv.customer?.name ?? "(顧客不明)",
      remaining,
      dueDate: due,
      predictedDate: predicted,
      shiftDays: due ? diffDays(predicted, due) : 0,
      confidence,
      risk,
      basis,
      aiReason: null,
    });
  }
  return { today, rows, profiles };
}

type NoteData = { summary: string; adjustments: Record<string, { extraDays: number; reason: string }> };

const monthOf = (d: string, current: string) => (d.slice(0, 7) < current ? current : d.slice(0, 7));

// 画面・資金繰りに使う予測(決まったルール + 最近のAIの見直し)
export async function getReceiptForecast(companyId: string, today = jstDateKey(new Date())) {
  const [r, note] = await Promise.all([predictReceipts(companyId, today), prisma.aiNote.findFirst({ where: { companyId, kind: NOTE_KIND }, orderBy: { key: "desc" } })]);
  const fresh = note && note.key >= addDays(today, -NOTE_DAYS) ? (note.data as NoteData) : null;
  const rows = r.rows.map((row) => {
    const adj = fresh?.adjustments?.[row.invoiceId];
    if (!adj || adj.extraDays <= 0) return row;
    const predictedDate = addDays(row.predictedDate, adj.extraDays);
    return { ...row, predictedDate, shiftDays: row.dueDate ? diffDays(predictedDate, row.dueDate) : row.shiftDays, aiReason: adj.reason };
  });
  // 月ごとの比較(期日どおり vs 予測)
  const current = today.slice(0, 7);
  const months = [0, 1, 2].map((i) => new Date(Date.UTC(Number(current.slice(0, 4)), Number(current.slice(5)) - 1 + i, 1)).toISOString().slice(0, 7));
  const sum = (key: "due" | "predicted") => months.map((m) => rows.filter((x) => monthOf(key === "due" ? (x.dueDate ?? today) : x.predictedDate, current) === m).reduce((s, x) => s + x.remaining, 0));
  const byDue = sum("due");
  const byPredicted = sum("predicted");
  return {
    today,
    rows,
    months: months.map((month, i) => ({ month, due: byDue[i], predicted: byPredicted[i] })),
    total: rows.reduce((s, x) => s + x.remaining, 0),
    later: rows.filter((x) => x.shiftDays > 0).reduce((s, x) => s + x.remaining, 0),
    risky: rows.filter((x) => x.risk),
    review: note ? { summary: (note.data as NoteData).summary, mode: note.mode, createdAt: note.createdAt.toISOString(), createdBy: note.createdBy, fresh: !!fresh } : null,
  };
}

// 資金繰り予測で、入金予定日を予測日に置きかえるための表
export async function receiptDates(companyId: string, today = jstDateKey(new Date())) {
  const f = await getReceiptForecast(companyId, today);
  return new Map(f.rows.map((r) => [r.invoiceId, { date: r.predictedDate, note: r.shiftDays > 0 ? `予測: 期日+${r.shiftDays}日` : r.shiftDays < 0 ? `予測: 期日−${-r.shiftDays}日` : undefined }]));
}

const SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "入金の見込みの所見(100字以内)" },
    adjustments: {
      type: "array",
      description: "予測より遅めに見ておくべき請求書だけ",
      items: {
        type: "object",
        properties: { index: { type: "integer" }, extraDays: { type: "integer", description: "予測日にさらに足す日数(1〜60)" }, reason: { type: "string", description: "理由(50字以内)" } },
        required: ["index", "extraDays", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["summary", "adjustments"],
  additionalProperties: false,
} as const;

export async function reviewReceiptForecast(user: { id: string; name: string; companyId: string }) {
  const companyId = user.companyId;
  const today = jstDateKey(new Date());
  const r = await predictReceipts(companyId, today);
  const later = r.rows.filter((x) => x.shiftDays > 0);
  const risky = r.rows.filter((x) => x.risk);
  let summary = r.rows.length
    ? `入金待ち ${formatYen(r.rows.reduce((s, x) => s + x.remaining, 0))}(${r.rows.length}件)のうち、${later.length ? `${formatYen(later.reduce((s, x) => s + x.remaining, 0))} は期日より遅れて入りそうです` : "期日より遅れそうなものはありません"}。${risky.length ? `督促が必要なものが ${risky.length}件 あります。` : ""}`
    : "入金待ちの請求書はありません。";
  const adjustments: NoteData["adjustments"] = {};
  let mode = "template";
  const ai = await aiFor(companyId);
  if (ai && r.rows.length) {
    if ((await prisma.assistantLog.count({ where: { companyId, createdAt: { gte: new Date(`${today}T00:00:00+09:00`) } } })) >= DAILY_LIMIT) throw new UserError(`AIの利用は1日${DAILY_LIMIT}回までです。明日またお試しください`);
    const pick = [...r.rows].sort((a, b) => b.remaining - a.remaining).slice(0, AI_ROWS);
    try {
      const response = await ai.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        system: [
          {
            type: "text",
            text: [
              "あなたは小さな会社の資金繰りを見る経理担当者です。入金待ちの請求書ごとの、期日・ルールでの入金予測日・その顧客の過去の払い方(JSON)を読み、資金繰りを安全に見るために、予測より遅めに見ておくべき請求書だけを選んでください。",
              "払い方が遅くなってきた顧客、ばらつきが大きい顧客(p80 が中央値より大きく遅い)、期日を大きく過ぎているもの、金額が大きく記録の少ない顧客などを考えてください。予測を早めることはできません。迷うものは選ばないでください。",
              "summary には、経営者向けに入金の見込みと気をつけることを書いてください。金額は「1,234円」の形で、データにないことは推測で書かないでください。",
            ].join("\n"),
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [
          {
            role: "user",
            content: JSON.stringify({
              today,
              invoices: pick.map((x, index) => {
                const p = x.customerId ? r.profiles.get(x.customerId) : undefined;
                return { index, customer: x.customer, remaining: x.remaining, dueDate: x.dueDate, predictedDate: x.predictedDate, basis: x.basis, history: p ? { count: p.count, medianLateDays: p.median, p80LateDays: p.p80, recentLateDays: p.recent, onTimeRate: Math.round(p.onTimeRate * 100) } : null };
              }),
            }),
          },
        ],
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
        const raw = JSON.parse(text) as { summary?: unknown; adjustments?: unknown };
        for (const a of Array.isArray(raw.adjustments) ? raw.adjustments : []) {
          const x = a as { index?: unknown; extraDays?: unknown; reason?: unknown };
          const row = Number.isInteger(Number(x.index)) ? pick[Number(x.index)] : undefined;
          const extra = Math.round(Number(x.extraDays));
          const reason = String(x.reason ?? "").trim().slice(0, 120);
          // 予測は遅らせることだけできる
          if (!row || !Number.isFinite(extra) || extra <= 0 || !reason) continue;
          adjustments[row.invoiceId] = { extraDays: Math.min(MAX_EXTRA, extra), reason };
        }
        const s = String(raw.summary ?? "").trim().slice(0, 200);
        if (s) summary = s;
        mode = "claude";
      }
    } catch (error) {
      if (!(error instanceof Anthropic.APIError) && !(error instanceof SyntaxError)) throw error;
    }
    await prisma.assistantLog.create({ data: { companyId, userId: user.id, question: "入金予測", tools: [], mode: `receipts-${mode}` } });
  }
  const data: NoteData = { summary, adjustments };
  return prisma.aiNote.upsert({
    where: { companyId_kind_key: { companyId, kind: NOTE_KIND, key: today } },
    create: { companyId, kind: NOTE_KIND, key: today, data, mode, createdBy: user.name },
    update: { data, mode, createdBy: user.name, createdAt: new Date() },
  });
}

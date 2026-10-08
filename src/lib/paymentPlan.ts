import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { aiFor } from "@/lib/ai/access";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { formatYen } from "@/lib/format";
import { buildCashFacts } from "@/lib/assistant/cashAdvice";
import { getReceiptForecast } from "@/lib/receiptForecast";
import { closedReason, prevBusinessDay } from "@/lib/holidays";

// 支払計画: この先2週間の支払い(受け取った請求書)を、いまの現預金と入金予測で払えるか日ごとに確かめ、
// 「支払う」「支払日をずらす相談をする」に分ける。
// ・期限切れのものは今日、そのほかは支払期限の日に払う。同じ日は金額の小さい順(払える件数を多くする)
// ・入金は入金予測の日に入る(督促が必要な入金は数えない)。同じ日は支払いを先にする(安全側)
// ・払うと「手元に残したい金額」を下回るものは「ずらす相談」にする
// ・振込先の口座がない取引先は、振込データを作れないので目印を付ける
// AIは、全体の見立てと、ずらす相談の伝え方や支払いの順番を一言ずつ書く(支払う/ずらすの判定は変えない)。

const MODEL = process.env.ANTHROPIC_ASSISTANT_MODEL || "claude-opus-5-5";
const DAILY_LIMIT = Number(process.env.ASSISTANT_DAILY_LIMIT || 100);
const DAY = 86_400_000;
const HORIZON = 14;
const OPEN = ["CONFIRMED", "SENT", "PARTIALLY_PAID", "OVERDUE"] as const;
const NOTE_KIND = "PAYMENT_PLAN";

export type PlanGroup = "OVERDUE" | "THIS_WEEK" | "NEXT_WEEK";
export type PlanAction = "PAY" | "DEFER";
export type PlanRow = {
  invoiceId: string;
  invoiceNumber: string | null;
  vendorId: string | null;
  vendor: string;
  dueDate: string | null;
  payDate: string;
  remaining: number;
  group: PlanGroup;
  action: PlanAction;
  hasAccount: boolean;
  reason: string;
  balanceAfter: number;
  aiNote: string | null;
};

export const GROUP_LABELS: Record<PlanGroup, string> = { OVERDUE: "期限切れ", THIS_WEEK: "今週(7日以内)", NEXT_WEEK: "来週(8〜14日)" };

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

const hasPayee = (v: unknown) => !!v && typeof v === "object" && !!(v as { accountNumber?: unknown }).accountNumber;

export async function defaultBuffer(companyId: string) {
  const facts = await buildCashFacts(companyId);
  // ふだんの1か月の支出の半分(1万円単位)を、手元に残す目安にする
  return { facts, buffer: Math.max(0, Math.round((facts.avgMonthlyExpense * 0.5) / 10_000) * 10_000) };
}

export async function buildPaymentPlan(companyId: string, bufferInput?: number | null) {
  const today = jstDateKey(new Date());
  const horizon = addDays(today, HORIZON);
  const [{ facts, buffer: suggested }, forecast, invoices] = await Promise.all([
    defaultBuffer(companyId),
    getReceiptForecast(companyId, today),
    prisma.invoice.findMany({
      where: { companyId, direction: "RECEIVED", status: { in: [...OPEN] } },
      include: { vendor: { select: { id: true, name: true, payeeAccount: true } }, payments: { select: { amount: true } } },
      orderBy: [{ dueDate: "asc" }],
    }),
  ]);
  const buffer = bufferInput !== null && bufferInput !== undefined && Number.isFinite(bufferInput) && bufferInput >= 0 ? Math.round(bufferInput) : suggested;
  const open = invoices
    .map((i) => ({ i, remaining: i.totalAmount - i.payments.reduce((s, p) => s + p.amount, 0), due: i.dueDate ? jstDateKey(i.dueDate) : null }))
    .filter((x) => x.remaining > 0);
  const inHorizon = open.filter((x) => !x.due || x.due <= horizon);
  const later = open.filter((x) => x.due && x.due > horizon);

  const receipts = forecast.rows.filter((r) => !r.risk && r.predictedDate <= horizon);
  type Event = { date: string; kind: "pay" | "receive"; amount: number; idx?: number };
  // 期限が銀行の休業日なら、その前の営業日に払う(今日より前にはしない)
  const payDay = (due: string | null) => {
    if (!due || due < today) return today;
    const prev = closedReason(due, "bank") ? prevBusinessDay(due, "bank") : due;
    return prev < today ? today : prev;
  };
  const pays = inHorizon.map((x, idx) => ({ ...x, idx, payDate: payDay(x.due) }));
  const events: Event[] = [
    ...pays.map((p) => ({ date: p.payDate, kind: "pay" as const, amount: p.remaining, idx: p.idx })),
    ...receipts.map((r) => ({ date: r.predictedDate < today ? today : r.predictedDate, kind: "receive" as const, amount: r.remaining })),
  ].sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.kind !== b.kind ? (a.kind === "pay" ? -1 : 1) : a.amount - b.amount));

  let balance = facts.cashNow;
  let lowest = { date: today, balance };
  const decided = new Map<number, { action: PlanAction; balanceAfter: number }>();
  for (const e of events) {
    if (e.kind === "receive") {
      balance += e.amount;
      continue;
    }
    if (balance - e.amount >= buffer) {
      balance -= e.amount;
      decided.set(e.idx!, { action: "PAY", balanceAfter: balance });
    } else {
      decided.set(e.idx!, { action: "DEFER", balanceAfter: balance });
    }
    if (balance < lowest.balance) lowest = { date: e.date, balance };
  }

  const rows: PlanRow[] = pays.map((p) => {
    const d = decided.get(p.idx)!;
    const group: PlanGroup = !p.due || p.due < today ? "OVERDUE" : p.due <= addDays(today, 7) ? "THIS_WEEK" : "NEXT_WEEK";
    const hasAccount = hasPayee(p.i.vendor?.payeeAccount);
    const shifted = p.due && p.payDate !== p.due && p.due >= today ? `期限の${p.due.slice(5).replace("-", "/")}は銀行の休業日(${closedReason(p.due, "bank")})なので前の営業日に。` : "";
    const reason =
      shifted +
      (d.action === "PAY"
        ? `${p.payDate.slice(5).replace("-", "/")}に払っても、残高は ${formatYen(d.balanceAfter)} あります`
        : `${p.payDate.slice(5).replace("-", "/")}に払うと残高が ${formatYen(d.balanceAfter - p.remaining)} になり、手元に残したい ${formatYen(buffer)} を下回ります`);
    return {
      invoiceId: p.i.id,
      invoiceNumber: p.i.invoiceNumber,
      vendorId: p.i.vendor?.id ?? null,
      vendor: p.i.vendor?.name ?? "(取引先なし)",
      dueDate: p.due,
      payDate: p.payDate,
      remaining: p.remaining,
      group,
      action: d.action,
      hasAccount,
      reason,
      balanceAfter: d.balanceAfter,
      aiNote: null,
    };
  });
  const order: PlanGroup[] = ["OVERDUE", "THIS_WEEK", "NEXT_WEEK"];
  rows.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group) || (a.payDate < b.payDate ? -1 : a.payDate > b.payDate ? 1 : a.remaining - b.remaining));
  const sum = (xs: { remaining: number }[]) => xs.reduce((s, x) => s + x.remaining, 0);
  return {
    today,
    horizon,
    cashNow: facts.cashNow,
    buffer,
    suggestedBuffer: suggested,
    receipts: sum(receipts),
    receiptCount: receipts.length,
    payTotal: sum(rows.filter((r) => r.action === "PAY")),
    deferTotal: sum(rows.filter((r) => r.action === "DEFER")),
    endBalance: balance,
    lowest,
    rows,
    later: { count: later.length, total: sum(later) },
  };
}

type NoteData = { summary: string; notes: Record<string, string>; buffer: number };

// 画面に出す支払計画(今日のAIの見直しがあれば一言を重ねる)
export async function getPaymentPlan(companyId: string, bufferInput?: number | null) {
  const plan = await buildPaymentPlan(companyId, bufferInput);
  const note = await prisma.aiNote.findUnique({ where: { companyId_kind_key: { companyId, kind: NOTE_KIND, key: plan.today } } });
  const data = note ? (note.data as NoteData) : null;
  // 手元に残す金額を変えると判定が変わるので、同じ条件で見直したときだけ一言を出す
  const same = data && data.buffer === plan.buffer;
  return {
    ...plan,
    rows: plan.rows.map((r) => ({ ...r, aiNote: same ? (data.notes[r.invoiceId] ?? null) : null })),
    review: note && data ? { summary: data.summary, mode: note.mode, createdAt: note.createdAt.toISOString(), createdBy: note.createdBy, buffer: data.buffer, current: !!same } : null,
  };
}

const SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "この2週間の支払いの見立て(100字以内)" },
    notes: {
      type: "array",
      items: { type: "object", properties: { index: { type: "integer" }, note: { type: "string", description: "その支払いについての一言(60字以内)" } }, required: ["index", "note"], additionalProperties: false },
    },
  },
  required: ["summary", "notes"],
  additionalProperties: false,
} as const;

export async function reviewPaymentPlan(user: { id: string; name: string; companyId: string }, bufferInput?: number | null) {
  const companyId = user.companyId;
  const plan = await buildPaymentPlan(companyId, bufferInput);
  const defer = plan.rows.filter((r) => r.action === "DEFER");
  const noAccount = plan.rows.filter((r) => r.action === "PAY" && !r.hasAccount);
  let summary = plan.rows.length
    ? `この2週間の支払い ${plan.rows.length}件 のうち、${formatYen(plan.payTotal)} は払えます。${defer.length ? `${formatYen(plan.deferTotal)}(${defer.length}件)は支払日をずらす相談をしましょう。` : ""}${noAccount.length ? `振込先の口座がない取引先が ${noAccount.length}件 あります。` : ""}`
    : "この2週間に支払期限の来る請求書はありません。";
  const notes: Record<string, string> = {};
  let mode = "template";
  const ai = await aiFor(companyId);
  if (ai && plan.rows.length) {
    const since = new Date(`${plan.today}T00:00:00+09:00`);
    if ((await prisma.assistantLog.count({ where: { companyId, createdAt: { gte: since } } })) >= DAILY_LIMIT) throw new UserError(`AIの利用は1日${DAILY_LIMIT}回までです。明日またお試しください`);
    const pick = plan.rows.slice(0, 40);
    try {
      const response = await ai.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        system: [
          {
            type: "text",
            text: [
              "あなたは小さな会社の支払いを預かる経理担当者です。この2週間の支払計画(JSON)を読み、経営者向けに全体の見立てを書き、支払いごとに必要なら一言を添えてください。",
              "action が DEFER のものには、支払日をずらしてもらう相談の伝え方(誰に・いつまでに・どう伝えるか)を、期限切れのものには早めの連絡を、口座がないもの(hasAccount=false)には口座の確認を書いてください。PAY と DEFER の判定は変えないでください。",
              "金額は「1,234円」の形で書き、データにないこと(取引先との関係など)は推測で書かないでください。",
            ].join("\n"),
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [
          {
            role: "user",
            content: JSON.stringify({
              today: plan.today,
              cashNow: plan.cashNow,
              keepAtLeast: plan.buffer,
              receiptsIn14Days: plan.receipts,
              lowest: plan.lowest,
              laterPayments: plan.later,
              payments: pick.map((r, index) => ({ index, vendor: r.vendor, amount: r.remaining, dueDate: r.dueDate, payDate: r.payDate, group: GROUP_LABELS[r.group], action: r.action, hasAccount: r.hasAccount, reason: r.reason })),
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
        const raw = JSON.parse(text) as { summary?: unknown; notes?: unknown };
        for (const n of Array.isArray(raw.notes) ? raw.notes : []) {
          const x = n as { index?: unknown; note?: unknown };
          const row = Number.isInteger(Number(x.index)) ? pick[Number(x.index)] : undefined;
          const note = String(x.note ?? "").trim().slice(0, 120);
          if (row && note) notes[row.invoiceId] = note;
        }
        const s = String(raw.summary ?? "").trim().slice(0, 200);
        if (s) summary = s;
        mode = "claude";
      }
    } catch (error) {
      if (!(error instanceof Anthropic.APIError) && !(error instanceof SyntaxError)) throw error;
    }
    await prisma.assistantLog.create({ data: { companyId, userId: user.id, question: "支払計画", tools: [], mode: `payplan-${mode}` } });
  }
  const data: NoteData = { summary, notes, buffer: plan.buffer };
  return prisma.aiNote.upsert({
    where: { companyId_kind_key: { companyId, kind: NOTE_KIND, key: plan.today } },
    create: { companyId, kind: NOTE_KIND, key: plan.today, data, mode, createdBy: user.name },
    update: { data, mode, createdBy: user.name, createdAt: new Date() },
  });
}

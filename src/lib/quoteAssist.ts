import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { formatYen } from "@/lib/format";

// AI見積アシスト: 「ホームページ制作 5ページ、ロゴ作成」のような文章から、見積書の明細の下書きを作る。
// 単価は、これまで出した請求書・見積書の同じような品目の単価(その顧客のものを優先)を参考にし、
// 過去の単価と大きく違う明細には目印を付ける。下書きは見積書の作成画面にそのまま渡し、人が確かめて作る。

const MODEL = process.env.ANTHROPIC_ASSISTANT_MODEL || "claude-opus-5-5";
const DAILY_LIMIT = Number(process.env.ASSISTANT_DAILY_LIMIT || 100);
const MAX_TEXT = 2000;
const MAX_LINES = 30;
const DRAFT_KIND = "QUOTE_DRAFT";
const DAY = 86_400_000;

export type PriceHistory = { count: number; min: number; max: number; median: number; last: { date: string; customer: string; unitPrice: number; description: string } | null; sameCustomer: boolean };
export type DraftLine = { description: string; quantity: number; unit: string | null; unitPrice: number; taxRate: number; note: string | null; history: PriceHistory | null; priceWarning: string | null };

const UNITS = ["ページ", "時間", "式", "個", "本", "件", "回", "か月", "ヶ月", "ケ月", "月", "日", "人", "枚", "台", "部", "点", "セット"];

const tokens = (s: string) =>
  s
    .normalize("NFKC")
    .replace(/[0-9,.円¥]+/g, " ")
    .split(/[\s、。・/()()「」[\]【】,]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !UNITS.includes(t));

// 過去の品目(発行した請求書・見積書の明細、直近2年)
async function pastLines(companyId: string) {
  const since = new Date(Date.now() - 730 * DAY);
  const [inv, quo] = await Promise.all([
    prisma.invoiceLine.findMany({
      where: { invoice: { companyId, direction: "ISSUED", status: { notIn: ["CANCELLED", "DRAFT"] }, issueDate: { gte: since } } },
      select: { description: true, unitPrice: true, unit: true, taxRate: true, invoice: { select: { issueDate: true, customer: { select: { name: true } } } } },
    }),
    prisma.quoteLine.findMany({
      where: { quote: { companyId, status: { not: "CANCELLED" }, issueDate: { gte: since } } },
      select: { description: true, unitPrice: true, unit: true, taxRate: true, quote: { select: { issueDate: true, customer: { select: { name: true } } } } },
    }),
  ]);
  return [
    ...inv.map((l) => ({ description: l.description, unitPrice: l.unitPrice, unit: l.unit, taxRate: l.taxRate, date: l.invoice.issueDate ? jstDateKey(l.invoice.issueDate) : "", customer: l.invoice.customer?.name ?? "" })),
    ...quo.map((l) => ({ description: l.description, unitPrice: l.unitPrice, unit: l.unit, taxRate: l.taxRate, date: jstDateKey(l.quote.issueDate), customer: l.quote.customer.name })),
  ].filter((l) => l.unitPrice > 0);
}
type Past = Awaited<ReturnType<typeof pastLines>>;

// 品目の言葉が重なる過去の明細から、単価の幅を出す(その顧客の明細があればそれだけで)
export function historyOf(past: Past, description: string, customerName: string): PriceHistory | null {
  const words = tokens(description);
  if (!words.length) return null;
  const similar = past.filter((p) => {
    const pw = tokens(p.description);
    return words.some((w) => pw.some((x) => x.includes(w) || w.includes(x)));
  });
  if (!similar.length) return null;
  const mine = similar.filter((p) => p.customer === customerName);
  const use = mine.length ? mine : similar;
  const prices = use.map((p) => p.unitPrice).sort((a, b) => a - b);
  const last = [...use].sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  return { count: use.length, min: prices[0], max: prices[prices.length - 1], median: prices[Math.floor((prices.length - 1) / 2)], last: { date: last.date, customer: last.customer, unitPrice: last.unitPrice, description: last.description }, sameCustomer: mine.length > 0 };
}

// APIキーがないとき: 1行(または「、」区切り)を1明細として、数量・単位・単価を読み取る
export function templateLines(text: string): Omit<DraftLine, "history" | "priceWarning">[] {
  return text
    .normalize("NFKC")
    .split(/\n|、|;/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_LINES)
    .map((chunk) => {
      const price = chunk.match(/([\d,]+)\s*円|¥\s*([\d,]+)/);
      const unitPrice = price ? Number((price[1] ?? price[2]).replace(/,/g, "")) : 0;
      let rest = price ? chunk.replace(price[0], " ") : chunk;
      const qty = rest.match(new RegExp(`([\\d.]+)\\s*(${UNITS.join("|")})`));
      const quantity = qty ? Number(qty[1]) : 1;
      const unit = qty ? qty[2] : "式";
      if (qty) rest = rest.replace(qty[0], " ");
      const description = rest.replace(/\s+/g, " ").replace(/^[\s:・-]+|[\s:・-]+$/g, "").slice(0, 200) || "作業";
      return { description, quantity: quantity > 0 ? quantity : 1, unit, unitPrice, taxRate: 10, note: null };
    });
}

function sanitize(raw: unknown): Omit<DraftLine, "history" | "priceWarning">[] {
  return (Array.isArray(raw) ? raw : []).slice(0, MAX_LINES).flatMap((r: Record<string, unknown>) => {
    const description = String(r?.description ?? "").trim().slice(0, 200);
    if (!description) return [];
    const quantity = Number(r?.quantity);
    const unitPrice = Math.round(Number(r?.unitPrice));
    return [
      {
        description,
        quantity: Number.isFinite(quantity) && quantity > 0 && quantity <= 100_000 ? Math.round(quantity * 100) / 100 : 1,
        unit: r?.unit ? String(r.unit).trim().slice(0, 10) || null : null,
        unitPrice: Number.isFinite(unitPrice) && unitPrice >= 0 && unitPrice <= 100_000_000 ? unitPrice : 0,
        taxRate: Number(r?.taxRate) === 8 ? 8 : 10,
        note: r?.note ? String(r.note).trim().slice(0, 120) || null : null,
      },
    ];
  });
}

function withHistory(lines: Omit<DraftLine, "history" | "priceWarning">[], past: Past, customerName: string): DraftLine[] {
  return lines.map((l) => {
    const history = historyOf(past, l.description, customerName);
    let unitPrice = l.unitPrice;
    let note = l.note;
    // 単価がわからなければ、過去の単価(中央値)を入れておく
    if (!unitPrice && history) {
      unitPrice = history.median;
      note = note ?? `過去の単価(${history.sameCustomer ? "この顧客" : "ほかの顧客"}の${history.count}件)から入れました`;
    }
    let priceWarning: string | null = null;
    if (history && unitPrice > 0 && history.median > 0) {
      const ratio = unitPrice / history.median;
      if (ratio >= 1.3 || ratio <= 0.7) priceWarning = `過去の単価(${formatYen(history.min)}〜${formatYen(history.max)}、よく使うのは ${formatYen(history.median)})より ${ratio > 1 ? "高め" : "安め"}です`;
    }
    if (!unitPrice) priceWarning = "単価が決まっていません。入れてください";
    return { ...l, unitPrice, note, history, priceWarning };
  });
}

const SCHEMA = {
  type: "object",
  properties: {
    lines: {
      type: "array",
      items: {
        type: "object",
        properties: {
          description: { type: "string", description: "品目(見積書にそのまま載せる言葉)" },
          quantity: { type: "number" },
          unit: { type: "string", description: "単位(式・時間・ページ・個・か月など)" },
          unitPrice: { type: "integer", description: "税抜の単価(円)。わからなければ0" },
          taxRate: { type: "integer", enum: [10, 8] },
          note: { type: "string", description: "単価の根拠や確かめてほしいこと(40字以内、なければ空)" },
        },
        required: ["description", "quantity", "unit", "unitPrice", "taxRate", "note"],
        additionalProperties: false,
      },
    },
    summary: { type: "string", description: "この見積についての一言(80字以内)" },
  },
  required: ["lines", "summary"],
  additionalProperties: false,
} as const;

export async function draftQuote(user: { id: string; name: string; companyId: string }, input: { customerName?: unknown; text?: unknown }) {
  const companyId = user.companyId;
  const text = String(input.text ?? "").trim();
  const customerName = String(input.customerName ?? "").trim().slice(0, 100);
  if (!text) throw new UserError("見積の内容を書いてください");
  if (text.length > MAX_TEXT) throw new UserError(`${MAX_TEXT}文字以内で書いてください`);
  const past = await pastLines(companyId);
  let lines = templateLines(text);
  let summary = "書いた内容を明細に分けました。単価と数量を確かめてください。";
  let mode = "template";
  if (process.env.ANTHROPIC_API_KEY) {
    const today = jstDateKey(new Date());
    if ((await prisma.assistantLog.count({ where: { companyId, createdAt: { gte: new Date(`${today}T00:00:00+09:00`) } } })) >= DAILY_LIMIT) throw new UserError(`AIの利用は1日${DAILY_LIMIT}回までです。明日またお試しください`);
    // 参考にする過去の品目(この顧客のものを先に、同じ品目は最新だけ)
    const seen = new Set<string>();
    const reference = [...past]
      .sort((a, b) => Number(b.customer === customerName) - Number(a.customer === customerName) || (a.date < b.date ? 1 : -1))
      .filter((p) => (seen.has(p.description) ? false : (seen.add(p.description), true)))
      .slice(0, 60)
      .map((p) => ({ description: p.description, unitPrice: p.unitPrice, unit: p.unit, customer: p.customer === customerName ? "この顧客" : "ほかの顧客", date: p.date }));
    try {
      const response = await new Anthropic().beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        system: [
          {
            type: "text",
            text: [
              "あなたは小さな会社の見積書づくりを手伝う担当者です。依頼の文章を、見積書の明細(品目・数量・単位・税抜単価・税率)に分けてください。",
              "単価は文章に書いてあればそれを使い、なければ過去の品目(reference、この顧客のものを優先)の単価を参考にしてください。参考になるものがなければ 0 にして、note に「単価を入れてください」と書いてください。勝手に相場を決めないでください。",
              "品目は見積書にそのまま載せられる丁寧な言葉にし、食品などの軽減税率の品目だけ税率8にしてください。",
            ].join("\n"),
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [{ role: "user", content: JSON.stringify({ customer: customerName || null, request: text, reference }) }],
        output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
      if (response.stop_reason !== "refusal" && response.stop_reason !== "max_tokens") {
        const raw = JSON.parse(
          response.content
            .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
            .map((b) => b.text)
            .join("")
            .trim(),
        ) as { lines?: unknown; summary?: unknown };
        const ai = sanitize(raw.lines);
        if (ai.length) {
          lines = ai;
          summary = String(raw.summary ?? "").trim().slice(0, 160) || summary;
          mode = "claude";
        }
      }
    } catch (error) {
      if (!(error instanceof Anthropic.APIError) && !(error instanceof SyntaxError)) throw error;
    }
    await prisma.assistantLog.create({ data: { companyId, userId: user.id, question: "AI見積アシスト", tools: [], mode: `quote-${mode}` } });
  }
  const result = withHistory(lines, past, customerName);
  if (!result.length) throw new UserError("明細にできる内容がありませんでした");
  const subtotal = result.reduce((s, l) => s + Math.round(l.quantity * l.unitPrice), 0);
  // 見積書の作成画面に渡すため、下書きを保存する(作成画面で ?draft= で読む)
  const draftId = randomUUID();
  await prisma.aiNote.create({ data: { companyId, kind: DRAFT_KIND, key: draftId, data: { customerName, lines: result, summary }, mode, createdBy: user.name } });
  return { draftId, customerName, lines: result, subtotal, summary, mode };
}

// 見積書の作成画面で使う下書き(24時間まで)
export async function getQuoteDraft(companyId: string, draftId: string) {
  if (!/^[0-9a-f-]{36}$/.test(draftId)) return null;
  const note = await prisma.aiNote.findUnique({ where: { companyId_kind_key: { companyId, kind: DRAFT_KIND, key: draftId } } });
  if (!note || Date.now() - note.createdAt.getTime() > DAY) return null;
  return note.data as { customerName: string; lines: DraftLine[]; summary: string };
}

import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { aiFor } from "@/lib/ai/access";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { createPurchaseOrder } from "@/lib/accounting/purchaseOrders";

// 発注の提案: 在庫の動き(出庫)から1日に使う量を出し、いまの在庫が何日もつかを見て、
// 納品までの日数(リードタイム)+次の発注までの日数分に足りない商品と、発注する数の目安を出す。
// 発注先・単価は、その商品を最後に頼んだ発注書(なければ最後の仕入)から。発注書の下書きは人がボタンを押して作る。

const MODEL = process.env.ANTHROPIC_ASSISTANT_MODEL || "claude-opus-5-5";
const DAILY_LIMIT = Number(process.env.ASSISTANT_DAILY_LIMIT || 100);
const DAY = 86_400_000;
const LOOKBACK = 60;

export type ReorderOptions = { leadDays: number; coverDays: number };

const days = (n: unknown, def: number, max: number) => {
  const v = Math.round(Number(n ?? def));
  return Number.isInteger(v) && v >= 0 && v <= max ? v : def;
};

export function reorderOptions(input: { leadDays?: unknown; coverDays?: unknown }): ReorderOptions {
  return { leadDays: days(input.leadDays, 7, 90), coverDays: days(input.coverDays, 30, 180) };
}

export async function getReorderSuggestions(companyId: string, opts: ReorderOptions, now = new Date()) {
  const since = new Date(now.getTime() - LOOKBACK * DAY);
  const [products, movements, orders] = await Promise.all([
    prisma.product.findMany({ where: { companyId }, orderBy: [{ code: "asc" }, { name: "asc" }] }),
    prisma.stockMovement.findMany({ where: { product: { companyId }, date: { gte: since } }, select: { productId: true, type: true, date: true, quantity: true, amount: true } }),
    prisma.purchaseOrder.findMany({
      where: { companyId, status: { in: ["OPEN", "RECEIVED"] } },
      select: { status: true, issueDate: true, vendor: { select: { name: true } }, lines: { select: { description: true, quantity: true, unitPrice: true, taxRate: true } } },
      orderBy: { issueDate: "desc" },
      take: 300,
    }),
  ]);
  const lastPurchases = await prisma.stockMovement.findMany({
    where: { product: { companyId }, type: "PURCHASE" },
    orderBy: { date: "desc" },
    distinct: ["productId"],
    select: { productId: true, quantity: true, amount: true },
  });
  const lastPurchase = new Map(lastPurchases.map((m) => [m.productId, m]));

  const rows = products.map((p) => {
    const mine = movements.filter((m) => m.productId === p.id);
    const issued = mine.filter((m) => m.type === "ISSUE");
    const usedTotal = issued.reduce((s, m) => s + m.quantity, 0);
    // 記録を始めてから60日たっていなければ、その日数で割る
    const first = mine.length ? Math.min(...mine.map((m) => m.date.getTime())) : now.getTime();
    const span = Math.max(14, Math.min(LOOKBACK, Math.ceil((now.getTime() - first) / DAY)));
    const daily = usedTotal / span;
    // 直近30日と、その前の30日の使った量(増えている・減っている)
    const recent = issued.filter((m) => m.date.getTime() >= now.getTime() - 30 * DAY).reduce((s, m) => s + m.quantity, 0);
    const before = usedTotal - recent;
    const daysLeft = daily > 0 ? p.quantityOnHand / daily : null;
    // 発注中(未検収)の発注書に入っている数
    const onOrder = orders
      .filter((o) => o.status === "OPEN")
      .flatMap((o) => o.lines.filter((l) => l.description.includes(p.name)))
      .reduce((s, l) => s + l.quantity, 0);
    const lastOrder = orders.find((o) => o.lines.some((l) => l.description.includes(p.name)));
    const lastLine = lastOrder?.lines.find((l) => l.description.includes(p.name));
    const lp = lastPurchase.get(p.id);
    const unitPrice = lastLine?.unitPrice ?? (lp && lp.quantity ? Math.round(lp.amount / lp.quantity) : p.quantityOnHand > 0 ? Math.round(p.inventoryValue / p.quantityOnHand) : 0);
    const need = Math.ceil(daily * (opts.leadDays + opts.coverDays));
    const belowPoint = p.reorderPoint !== null && p.quantityOnHand <= p.reorderPoint;
    const runsOut = daysLeft !== null && daysLeft <= opts.leadDays + 3;
    const available = p.quantityOnHand + onOrder;
    let suggested = Math.max(0, need - available);
    if (belowPoint && suggested === 0 && p.reorderPoint !== null) suggested = Math.max(0, p.reorderPoint * 2 - available);
    const reasons: string[] = [];
    if (p.quantityOnHand <= 0) reasons.push("在庫がありません");
    if (belowPoint) reasons.push(`発注点(${p.reorderPoint}${p.unit})以下です`);
    if (runsOut) reasons.push(`あと約${Math.max(0, Math.floor(daysLeft!))}日でなくなります`);
    if (onOrder > 0) reasons.push(`発注中 ${onOrder}${p.unit}`);
    if (before > 0 && recent > before * 1.3) reasons.push("最近よく出ています");
    return {
      productId: p.id,
      code: p.code,
      name: p.name,
      unit: p.unit,
      onHand: p.quantityOnHand,
      reorderPoint: p.reorderPoint,
      dailyUse: Math.round(daily * 10) / 10,
      usedRecent: recent,
      usedBefore: before,
      daysLeft: daysLeft === null ? null : Math.floor(daysLeft),
      onOrder,
      suggested,
      unitPrice,
      taxRate: lastLine?.taxRate ?? 10,
      vendorName: lastOrder?.vendor.name ?? null,
      needed: suggested > 0 && (belowPoint || runsOut || p.quantityOnHand <= 0),
      reasons,
      aiNote: null as string | null,
    };
  });
  const needed = rows.filter((r) => r.needed).sort((a, b) => (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999));
  return { options: opts, lookbackDays: LOOKBACK, needed, others: rows.filter((r) => !r.needed), checked: rows.length };
}

// AIの見立て: 使う量の増減・季節・まとめて頼む先などを読んで、数の調整の目安と一言を付ける(数は人が決める)
export async function reviewReorder(user: { id: string; companyId: string }, opts: ReorderOptions) {
  const r = await getReorderSuggestions(user.companyId, opts);
  const ai = await aiFor(user.companyId);
  let summary = r.needed.length
    ? `発注が必要そうな商品は ${r.needed.length}件です。在庫が早くなくなる順に並べています。`
    : "いま発注が必要そうな商品はありません。";
  let mode: "claude" | "template" = "template";
  if (ai && r.needed.length) {
    const today = jstDateKey(new Date());
    if ((await prisma.assistantLog.count({ where: { companyId: user.companyId, createdAt: { gte: new Date(`${today}T00:00:00+09:00`) } } })) >= DAILY_LIMIT) throw new UserError(`AIの利用は1日${DAILY_LIMIT}回までです。明日またお試しください`);
    try {
      const response = await ai.beta.messages.create({
        model: MODEL,
        max_tokens: 4000,
        system: [
          {
            type: "text",
            text: "あなたは小さなお店・会社の仕入担当です。在庫の提案(1日に使う量・直近30日とその前の30日の量・在庫が何日もつか・発注中の数・提案の数)を読み、提案の数を増やす/減らすほうがよい商品にだけ短い一言(note)を、全体には2文の summary を書いてください。数字は作らず、渡した数字を使ってください。",
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [{ role: "user", content: JSON.stringify({ leadDays: opts.leadDays, coverDays: opts.coverDays, items: r.needed.map((x, index) => ({ index, name: x.name, unit: x.unit, onHand: x.onHand, dailyUse: x.dailyUse, usedRecent30: x.usedRecent, usedPrevious30: x.usedBefore, daysLeft: x.daysLeft, onOrder: x.onOrder, suggested: x.suggested })) }) }],
        output_config: {
          effort: "low",
          format: {
            type: "json_schema",
            schema: {
              type: "object",
              properties: {
                summary: { type: "string" },
                notes: { type: "array", items: { type: "object", properties: { index: { type: "integer" }, note: { type: "string" } }, required: ["index", "note"], additionalProperties: false } },
              },
              required: ["summary", "notes"],
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
        ) as { summary?: unknown; notes?: unknown };
        for (const n of Array.isArray(raw.notes) ? raw.notes : []) {
          const x = n as { index?: unknown; note?: unknown };
          const row = r.needed[Number(x.index)];
          const note = String(x.note ?? "").trim().slice(0, 120);
          if (row && Number.isInteger(Number(x.index)) && note) row.aiNote = note;
        }
        const s = String(raw.summary ?? "").trim().slice(0, 300);
        if (s) summary = s;
        mode = "claude";
      }
    } catch (error) {
      if (!(error instanceof Anthropic.APIError) && !(error instanceof SyntaxError)) throw error;
    }
    await prisma.assistantLog.create({ data: { companyId: user.companyId, userId: user.id, question: "発注の提案", tools: [], mode: `reorder-${mode}` } });
  }
  return { ...r, summary, mode };
}

// 選んだ商品から、発注先ごとに発注書を作る
export async function createReorderPurchaseOrders(companyId: string, input: { items?: unknown; deliveryDate?: unknown }) {
  const today = jstDateKey(new Date());
  const deliveryDate = String(input.deliveryDate ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(deliveryDate) || deliveryDate < today) throw new UserError("納期を今日以降の日付で入れてください");
  const items = (Array.isArray(input.items) ? input.items : []).slice(0, 100).map((x) => x as Record<string, unknown>);
  if (!items.length) throw new UserError("発注する商品を選んでください");
  const products = await prisma.product.findMany({ where: { companyId, id: { in: items.map((i) => String(i.productId ?? "")) } } });
  const byVendor = new Map<string, { description: string; quantity: number; unit: string; unitPrice: number; taxRate: number }[]>();
  for (const it of items) {
    const p = products.find((x) => x.id === String(it.productId ?? ""));
    if (!p) throw new UserError("商品が見つかりません");
    const quantity = Math.round(Number(it.quantity));
    const unitPrice = Math.round(Number(it.unitPrice));
    const vendorName = String(it.vendorName ?? "").trim();
    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 1_000_000) throw new UserError(`「${p.name}」の数を正しく入れてください`);
    if (!Number.isInteger(unitPrice) || unitPrice <= 0) throw new UserError(`「${p.name}」の単価を入れてください`);
    if (!vendorName) throw new UserError(`「${p.name}」の発注先を入れてください`);
    const taxRate = Number(it.taxRate) === 8 ? 8 : 10;
    const list = byVendor.get(vendorName) ?? [];
    list.push({ description: p.name, quantity, unit: p.unit, unitPrice, taxRate });
    byVendor.set(vendorName, list);
  }
  const created: { id: string; orderNumber: string; vendor: string; total: number }[] = [];
  for (const [vendorName, lines] of byVendor) {
    const po = await createPurchaseOrder(companyId, { vendorName, issueDate: today, deliveryDate, lines, notes: "発注の提案から作成" });
    created.push({ id: po.id, orderNumber: po.orderNumber, vendor: vendorName, total: po.totalAmount });
  }
  return created;
}

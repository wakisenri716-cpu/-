import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { createPurchaseOrder } from "@/lib/accounting/purchaseOrders";
import { listStock, PER_DAY, type Category } from "@/lib/stockpile";

// 備蓄品の入れかえ・買い足し: 期限が近い・切れたものの入れかえと、3日分に足りない分の買い足しを、発注書の下書きにする。
// 前に発注書で買った単価・発注先があれば目安に出す。水・食料は軽減税率(8%)、ほかは10%。

type Me = { companyId: string; name: string; role: string };
const canManage = (role: string) => role === "ADMIN" || role === "ACCOUNTANT";

export type RestockLine = { key: string; reason: "REPLACE" | "SHORT"; itemId: string | null; category: Category; description: string; quantity: number; unit: string | null; unitPrice: number | null; taxRate: number; vendor: string | null; ordered: boolean };

// 足りない分を買い足すときの品物(1つあたりの量)
const BUY: Partial<Record<Category, { description: string; unit: string; per: number }>> = {
  WATER: { description: "保存水 2L", unit: "本", per: 2 },
  FOOD: { description: "非常食(1食分)", unit: "食", per: 1 },
  TOILET: { description: "簡易トイレ(1回分)", unit: "回分", per: 1 },
};
const NOTE = "防災の備蓄品の入れかえ・買い足し";
const taxOf = (c: Category) => (c === "WATER" || c === "FOOD" ? 8 : 10);

export async function restockPlan(companyId: string, people?: number) {
  const d = await listStock(companyId, people);
  const poLines = await prisma.purchaseOrderLine.findMany({ where: { purchaseOrder: { companyId } }, include: { purchaseOrder: { select: { vendor: { select: { name: true } } } } }, orderBy: { purchaseOrder: { issueDate: "desc" } }, take: 500 });
  const last = (name: string) => {
    const k = name.replace(/\s/g, "").toLowerCase();
    const l = poLines.find((x) => {
      const dsc = x.description.replace(/\s/g, "").toLowerCase();
      return dsc === k || dsc.includes(k) || (k.length >= 3 && k.includes(dsc));
    });
    return l ? { unitPrice: l.unitPrice, taxRate: l.taxRate, vendor: l.purchaseOrder.vendor.name } : null;
  };
  // まだ届いていない備蓄品の発注書(足りない分を二重に頼まないため)
  const openOrders = await prisma.purchaseOrder.findMany({ where: { companyId, status: "OPEN", notes: NOTE }, select: { lines: { select: { description: true } } } });
  const pending = new Set(openOrders.flatMap((o) => o.lines.map((l) => l.description)));
  const lines: RestockLine[] = [];
  // 入れかえ: 期限が近い・切れたもの(数が0のものは除く)
  const replace = d.items.filter((i) => i.state !== "OK" && i.quantity > 0);
  for (const i of replace) {
    const description = i.category === "WATER" && i.amountPerUnit ? `${i.name} ${i.amountPerUnit < 1 ? `${Math.round(i.amountPerUnit * 1000)}ml` : `${i.amountPerUnit}L`}` : i.name;
    const l = last(description);
    lines.push({ key: `r-${i.id}`, reason: "REPLACE", itemId: i.id, category: i.category as Category, description, quantity: i.quantity, unit: i.unit, unitPrice: l?.unitPrice ?? null, taxRate: l?.taxRate ?? taxOf(i.category as Category), vendor: l?.vendor ?? null, ordered: !!i.restockOrderId });
  }
  // 買い足し: 切れたものを入れかえたあとでも3日分に足りない分
  for (const c of d.coverage) {
    const buy = BUY[c.category as Category];
    if (!buy || !c.short) continue;
    const back = replace.filter((i) => i.category === c.category && i.state === "EXPIRED").reduce((s, i) => s + i.quantity * (i.amountPerUnit ?? (c.category === "WATER" ? 0 : 1)), 0);
    const short = c.short - back;
    if (short <= 0) continue;
    const l = last(buy.description);
    lines.push({ key: `s-${c.category}`, reason: "SHORT", itemId: null, category: c.category as Category, description: buy.description, quantity: Math.ceil(short / buy.per), unit: buy.unit, unitPrice: l?.unitPrice ?? null, taxRate: l?.taxRate ?? taxOf(c.category as Category), vendor: l?.vendor ?? null, ordered: pending.has(buy.description) });
  }
  const vendors = [...new Set(lines.map((l) => l.vendor).filter((v): v is string => !!v))];
  return { people: d.people, lines, vendor: vendors[0] ?? null, perDay: PER_DAY };
}

// 発注書を作る。入れかえの品物には発注書のしるしをつける(期限を直すと外れる)
export async function orderRestock(me: Me, raw: Record<string, unknown>) {
  if (!canManage(me.role)) throw new UserError("発注は管理者・経理担当ができます");
  const items = (Array.isArray(raw.lines) ? raw.lines : []).slice(0, 50) as Record<string, unknown>[];
  if (!items.length) throw new UserError("発注する品物を選んでください");
  for (const i of items) {
    if (!String(i.description ?? "").trim()) throw new UserError("品物の名前を入れてください");
    if (!(Number(i.quantity) > 0)) throw new UserError(`${i.description}の数を入れてください`);
    if (!(Number(i.unitPrice) >= 0) || String(i.unitPrice ?? "") === "") throw new UserError(`${i.description}の単価を入れてください`);
  }
  const itemIds = items.map((i) => (typeof i.itemId === "string" ? i.itemId : null)).filter((x): x is string => !!x);
  const own = itemIds.length ? await prisma.stockpileItem.findMany({ where: { companyId: me.companyId, id: { in: itemIds } }, select: { id: true } }) : [];
  if (own.length !== new Set(itemIds).size) throw new UserError("備蓄品が見つかりません。画面を読み直してください");
  const today = jstDateKey(new Date());
  const order = await createPurchaseOrder(me.companyId, {
    vendorName: String(raw.vendorName ?? ""),
    issueDate: today,
    deliveryDate: String(raw.deliveryDate ?? "") || today,
    deliveryPlace: null,
    paymentTerms: null,
    notes: NOTE,
    lines: items.map((i) => ({ description: String(i.description).slice(0, 200), quantity: Number(i.quantity), unit: i.unit ? String(i.unit) : null, unitPrice: Number(i.unitPrice), taxRate: Number(i.taxRate) === 8 ? 8 : 10 })),
  });
  if (itemIds.length) await prisma.stockpileItem.updateMany({ where: { companyId: me.companyId, id: { in: itemIds } }, data: { restockOrderId: order.id } });
  return { order: { id: order.id, orderNumber: order.orderNumber, totalAmount: order.totalAmount }, count: items.length };
}

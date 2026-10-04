import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { recordStockMovement } from "@/lib/accounting/inventory";

// スタッフアプリの在庫: 在庫数の確認と、出庫・棚卸(実際に数えた数)の記録。金額は見せない。
// 入荷(仕入)は単価・支払方法が要るので、管理者が「在庫管理」か発注書の検収で記録する。

export async function listStock(companyId: string) {
  const products = await prisma.product.findMany({
    where: { companyId },
    include: { movements: { orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 5, select: { type: true, date: true, quantity: true, memo: true } } },
    orderBy: [{ code: "asc" }, { name: "asc" }],
  });
  const rows = products.map((p) => {
    const low = p.reorderPoint === null ? p.quantityOnHand <= 0 : p.quantityOnHand <= p.reorderPoint;
    return {
      id: p.id,
      code: p.code,
      name: p.name,
      unit: p.unit,
      quantity: p.quantityOnHand,
      reorderPoint: p.reorderPoint,
      low,
      recent: p.movements.map((m) => ({ type: m.type, date: jstDateKey(m.date), quantity: m.quantity, memo: m.memo })),
    };
  });
  return { products: rows, low: rows.filter((r) => r.low).length };
}

export async function recordStaffMovement(companyId: string, user: { name: string }, input: { productId?: unknown; type?: unknown; quantity?: unknown; memo?: unknown }) {
  const type = String(input.type ?? "");
  if (type !== "ISSUE" && type !== "STOCKTAKE") throw new UserError("出庫か棚卸を選んでください");
  const quantity = Number(input.quantity);
  const memo = String(input.memo ?? "").trim().slice(0, 100);
  const today = jstDateKey(new Date());
  const result = await recordStockMovement(companyId, {
    productId: String(input.productId ?? ""),
    type,
    date: new Date(`${today}T00:00:00Z`),
    quantity,
    // 誰がスマホから記録したかを残す
    memo: `スタッフアプリ(${user.name})${memo ? ` ${memo}` : ""}`,
  });
  return { product: result.product, type, quantity };
}

import { requireCompanyId } from "@/lib/auth/session";
import { getInventory } from "@/lib/accounting/inventory";
import { csvResponse } from "@/lib/csv";

export async function GET() {
  const companyId = await requireCompanyId();
  const { products, totalValue } = await getInventory(companyId);
  return csvResponse("在庫一覧.csv", [
    ["商品コード", "商品名", "在庫数", "単位", "平均単価", "在庫金額"],
    ...products.map((p) => [p.code ?? "", p.name, p.quantityOnHand, p.unit, p.averageUnitCost, p.inventoryValue]),
    ["", "合計", "", "", "", totalValue],
  ]);
}

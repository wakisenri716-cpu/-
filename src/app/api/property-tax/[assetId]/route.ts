import { requireCompanyId } from "@/lib/auth/session";
import { ASSET_TYPES, setTaxAssetType } from "@/lib/accounting/propertyTax";
import { respond } from "@/lib/shifts/http";
import { audit } from "@/lib/audit";

// 固定資産の、償却資産申告での種類を決める: { taxAssetType: "1"〜"6" | "EXCLUDED" | "" }
export async function PATCH(request: Request, { params }: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await params;
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    const a = await setTaxAssetType(companyId, assetId, body.taxAssetType);
    const label = a.taxAssetType === "EXCLUDED" ? "対象外" : (ASSET_TYPES.find((t) => t.key === a.taxAssetType)?.label ?? "未分類");
    await audit("償却資産の種類を変更", `${a.name} → ${label}`);
    return { id: a.id, taxAssetType: a.taxAssetType };
  });
}

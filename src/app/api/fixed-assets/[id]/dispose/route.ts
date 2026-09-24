import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { disposeFixedAsset } from "@/lib/accounting/fixedAssets";
import { audit, yen } from "@/lib/audit";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  try {
    const price = Number(body.price ?? 0);
    const result = await disposeFixedAsset(companyId, id, { date: String(body.date ?? ""), price, receiveTo: body.receiveTo ? String(body.receiveTo) : undefined });
    await audit(price > 0 ? "固定資産を売却" : "固定資産を除却", `${result.asset.name}${price > 0 ? ` ${yen(price)}` : ""}`);
    return NextResponse.json({ gain: result.gain }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "処理に失敗しました" }, { status: 400 });
  }
}

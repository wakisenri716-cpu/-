import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { getFixedAssetsWithSummary, registerFixedAsset } from "@/lib/accounting/fixedAssets";
import { audit, yen } from "@/lib/audit";

export async function GET() {
  const companyId = await requireCompanyId();
  const assets = await getFixedAssetsWithSummary(companyId);
  return NextResponse.json(assets);
}

export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));

  const name = String(body.name || "").trim();
  const acquisitionCost = Number(body.acquisitionCost);
  const usefulLifeYears = Number(body.usefulLifeYears);
  const residualValue = body.residualValue === undefined || body.residualValue === "" ? 1 : Number(body.residualValue);
  const acquisitionDate = body.acquisitionDate ? new Date(body.acquisitionDate) : new Date();

  if (!name) {
    return NextResponse.json({ error: "資産名を入力してください" }, { status: 400 });
  }
  if (!Number.isFinite(acquisitionCost) || acquisitionCost <= 0) {
    return NextResponse.json({ error: "取得価額を正しく入力してください" }, { status: 400 });
  }
  if (!Number.isFinite(usefulLifeYears) || usefulLifeYears <= 0) {
    return NextResponse.json({ error: "耐用年数を正しく入力してください" }, { status: 400 });
  }

  try {
    const asset = await registerFixedAsset(companyId, {
      name,
      acquisitionDate,
      acquisitionCost,
      usefulLifeYears,
      residualValue,
    });
    await audit("固定資産を登録", `${asset.name} ${yen(asset.acquisitionCost)}`);
    return NextResponse.json(asset, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "登録に失敗しました" }, { status: 400 });
  }
}

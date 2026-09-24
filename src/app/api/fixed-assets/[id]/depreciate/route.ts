import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { postDepreciation } from "@/lib/accounting/fixedAssets";
import { requireCompanyId } from "@/lib/auth/session";
import { audit, yen } from "@/lib/audit";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: fixedAssetId } = await params;
  const companyId = await requireCompanyId();
  const asset = await prisma.fixedAsset.findFirst({ where: { id: fixedAssetId, companyId } });
  if (!asset) {
    return NextResponse.json({ error: "固定資産が見つかりません" }, { status: 404 });
  }
  const body = await request.json().catch(() => ({}));

  const now = new Date();
  const defaultPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const period = body.period || defaultPeriod;

  try {
    const result = await postDepreciation(fixedAssetId, period);
    await audit("減価償却を計上", `${asset.name} ${period} ${yen(result.depreciationEntry.amount)}`);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "計上に失敗しました" }, { status: 400 });
  }
}

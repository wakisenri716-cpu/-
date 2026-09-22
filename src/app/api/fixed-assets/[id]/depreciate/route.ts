import { NextResponse } from "next/server";
import { postDepreciation } from "@/lib/accounting/fixedAssets";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: fixedAssetId } = await params;
  const body = await request.json().catch(() => ({}));

  const now = new Date();
  const defaultPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const period = body.period || defaultPeriod;

  try {
    const result = await postDepreciation(fixedAssetId, period);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "計上に失敗しました" }, { status: 400 });
  }
}

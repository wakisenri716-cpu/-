import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { postDepreciationForAll } from "@/lib/accounting/fixedAssets";
import { audit, yen } from "@/lib/audit";

export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  try {
    const period = String(body.period ?? "");
    const result = await postDepreciationForAll(companyId, period);
    if (result.posted) await audit("減価償却をまとめて計上", `${period} ${result.posted}件 ${yen(result.total)}`);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "計上に失敗しました" }, { status: 400 });
  }
}

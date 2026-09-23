import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { getPosSummary } from "@/lib/pos/importSales";
import { getSmaregiConfig } from "@/lib/pos/smaregi";

export async function GET() {
  const companyId = await requireCompanyId();
  const config = getSmaregiConfig();
  return NextResponse.json({
    smaregi: { connected: !!config, sandbox: config?.sandbox ?? false },
    days: await getPosSummary(companyId),
  });
}

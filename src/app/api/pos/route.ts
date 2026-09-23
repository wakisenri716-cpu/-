import { NextResponse } from "next/server";
import { getDefaultCompanyId } from "@/lib/demo";
import { getPosSummary } from "@/lib/pos/importSales";
import { getSmaregiConfig } from "@/lib/pos/smaregi";

export async function GET() {
  const companyId = await getDefaultCompanyId();
  const config = getSmaregiConfig();
  return NextResponse.json({
    smaregi: { connected: !!config, sandbox: config?.sandbox ?? false },
    days: await getPosSummary(companyId),
  });
}

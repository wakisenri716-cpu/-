import { NextResponse } from "next/server";
import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { getCustomerProfit, reviewCustomerProfit } from "@/lib/customerProfit";

// 顧客別の採算。GET は数字、POST は AI の次の一手つき(何も保存しない)
export async function GET() {
  const companyId = await requireCompanyId();
  return NextResponse.json(await getCustomerProfit(companyId));
}

export async function POST() {
  await requireCompanyId();
  const user = await requireMember();
  return respond(() => reviewCustomerProfit(user));
}

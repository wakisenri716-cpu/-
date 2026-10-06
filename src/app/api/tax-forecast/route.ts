import { NextResponse } from "next/server";
import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { adviseTaxForecast, getTaxForecast } from "@/lib/taxForecast";

// 今期の着地見込みと納税の目安。GET は数字、POST { amounts } は AI の見立て(何も保存しない)
export async function GET() {
  const companyId = await requireCompanyId();
  return NextResponse.json(await getTaxForecast(companyId));
}

export async function POST(request: Request) {
  await requireCompanyId();
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(() => adviseTaxForecast(user, { amounts: body.amounts }));
}

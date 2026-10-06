import { NextResponse } from "next/server";
import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { adviseLabor, getLaborAnalysis } from "@/lib/laborAnalysis";

// 人件費の分析。GET ?month は数字、POST { month } は AI の見立て(何も保存しない)
export async function GET(request: Request) {
  const companyId = await requireCompanyId();
  return NextResponse.json(await getLaborAnalysis(companyId, new URL(request.url).searchParams.get("month")));
}

export async function POST(request: Request) {
  await requireCompanyId();
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(() => adviseLabor(user, typeof body.month === "string" ? body.month : null));
}

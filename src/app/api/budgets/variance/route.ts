import { NextResponse } from "next/server";
import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { explainBudgetVariance, getBudgetVariance } from "@/lib/budgetVariance";

// 予算と実績の差の原因。GET は決まったルールだけ、POST は AI の見立ても付ける(何も保存しない)
export async function GET(request: Request) {
  const companyId = await requireCompanyId();
  const fy = new URL(request.url).searchParams.get("fy");
  return NextResponse.json(await getBudgetVariance(companyId, fy));
}

export async function POST(request: Request) {
  await requireCompanyId();
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(() => explainBudgetVariance(user, { fiscalYear: body.fiscalYear, useAi: body.useAi }));
}

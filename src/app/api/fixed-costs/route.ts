import { NextResponse } from "next/server";
import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { findFixedCosts, reviewFixedCosts } from "@/lib/fixedCosts";

// 固定費・サブスクの見直し。GET は決まったルールだけ、POST は AI の見直しの候補つき(何も保存しない)
export async function GET() {
  const companyId = await requireCompanyId();
  return NextResponse.json(await findFixedCosts(companyId));
}

export async function POST() {
  await requireCompanyId();
  const user = await requireMember();
  return respond(() => reviewFixedCosts(user));
}

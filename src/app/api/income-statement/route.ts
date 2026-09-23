import { NextResponse } from "next/server";
import { getIncomeStatement } from "@/lib/accounting/incomeStatement";
import { requireCompanyId } from "@/lib/auth/session";

export async function GET() {
  const companyId = await requireCompanyId();
  const statement = await getIncomeStatement(companyId);
  return NextResponse.json(statement);
}

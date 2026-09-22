import { NextResponse } from "next/server";
import { getIncomeStatement } from "@/lib/accounting/incomeStatement";
import { getDefaultCompanyId } from "@/lib/demo";

export async function GET() {
  const companyId = await getDefaultCompanyId();
  const statement = await getIncomeStatement(companyId);
  return NextResponse.json(statement);
}

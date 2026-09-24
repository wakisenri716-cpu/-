import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { getReimbursements } from "@/lib/accounting/reimbursement";

export async function GET() {
  const companyId = await requireCompanyId();
  return NextResponse.json(await getReimbursements(companyId));
}

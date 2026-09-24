import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { issueAllDueInvoices } from "@/lib/accounting/recurringInvoices";
import { audit } from "@/lib/audit";

export async function POST() {
  const companyId = await requireCompanyId();
  const result = await issueAllDueInvoices(companyId);
  if (result.issued) await audit("定期請求をまとめて作成", `${result.issued}件`);
  return NextResponse.json(result);
}

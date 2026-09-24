import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { postAllDue } from "@/lib/accounting/recurring";
import { audit } from "@/lib/audit";

export async function POST() {
  const companyId = await requireCompanyId();
  const result = await postAllDue(companyId);
  if (result.posted) await audit("定期取引をまとめて記帳", `${result.posted}件`);
  return NextResponse.json(result);
}

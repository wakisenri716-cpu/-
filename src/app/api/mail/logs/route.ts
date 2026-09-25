import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { listEmailLogs } from "@/lib/mail";

export async function GET() {
  const companyId = await requireCompanyId();
  return NextResponse.json(await listEmailLogs(companyId));
}

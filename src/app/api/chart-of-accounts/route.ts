import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { createAccount, listChart } from "@/lib/accounting/chartManagement";
import { UserError } from "@/lib/errors";
import { audit } from "@/lib/audit";

export async function GET() {
  const companyId = await requireCompanyId();
  return NextResponse.json(await listChart(companyId));
}

export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  try {
    const account = await createAccount(companyId, { code: String(body.code ?? ""), name: String(body.name ?? "") });
    await audit("勘定科目を追加", `${account.code} ${account.name}`);
    return NextResponse.json(account, { status: 201 });
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}

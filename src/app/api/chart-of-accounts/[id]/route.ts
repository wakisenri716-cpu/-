import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { updateAccount } from "@/lib/accounting/chartManagement";
import { UserError } from "@/lib/errors";
import { audit } from "@/lib/audit";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  try {
    const account = await updateAccount(companyId, id, {
      ...(typeof body.name === "string" ? { name: body.name } : {}),
      ...(typeof body.hidden === "boolean" ? { hidden: body.hidden } : {}),
    });
    const what = typeof body.hidden === "boolean" ? (body.hidden ? "非表示にした" : "表示に戻した") : "名前を変更";
    await audit("勘定科目を変更", `${account.code} ${account.name}: ${what}`);
    return NextResponse.json(account);
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}

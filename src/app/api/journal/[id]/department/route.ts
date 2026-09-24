import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { setEntryDepartment } from "@/lib/accounting/departments";
import { UserError } from "@/lib/errors";

// 仕訳の部門を付け替える(どの種類の仕訳でも可。締めた期間は不可)
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  try {
    await setEntryDepartment(companyId, id, body.departmentId ? String(body.departmentId) : null);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}

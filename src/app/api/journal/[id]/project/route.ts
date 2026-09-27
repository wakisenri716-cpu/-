import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { setEntryProject } from "@/lib/accounting/projects";
import { toBooksClosedError, UserError } from "@/lib/errors";

// 仕訳の案件を付け替える(どの種類の仕訳でも可。締めた期間は不可)
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  try {
    await setEntryProject(companyId, id, body.projectId || null);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const closed = toBooksClosedError(error);
    if (closed) return NextResponse.json({ error: closed.message }, { status: 400 });
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}

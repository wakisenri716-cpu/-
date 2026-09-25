import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { deleteFolder, updateFolder } from "@/lib/files";
import { audit } from "@/lib/audit";
import { UserError } from "@/lib/errors";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const companyId = await requireCompanyId();
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  try {
    const folder = await updateFolder(companyId, id, body);
    await audit(body.parentId !== undefined ? "フォルダを移動" : "フォルダの名前を変更", folder.name);
    return NextResponse.json(folder);
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const companyId = await requireCompanyId();
  const { id } = await params;
  try {
    const name = await deleteFolder(companyId, id);
    await audit("フォルダを削除", name);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}

import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { deleteFile, getFileContent, updateFile, viewableOf } from "@/lib/files";
import { audit } from "@/lib/audit";
import { UserError } from "@/lib/errors";

// ファイルの中身。PDF・画像はブラウザで表示(印刷)できるように返し、それ以外と ?download=1 はダウンロードさせる。
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const companyId = await requireCompanyId();
  const { id } = await params;
  const file = await getFileContent(companyId, id);
  if (!file) return NextResponse.json({ error: "ファイルが見つかりません" }, { status: 404 });
  const inline = !!viewableOf(file.mimeType) && new URL(request.url).searchParams.get("download") !== "1";
  const encoded = encodeURIComponent(file.name);
  return new NextResponse(new Uint8Array(file.data), {
    headers: {
      "Content-Type": viewableOf(file.mimeType) ? file.mimeType : "application/octet-stream",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${encoded}"; filename*=UTF-8''${encoded}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=300",
    },
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const companyId = await requireCompanyId();
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  try {
    const file = await updateFile(companyId, id, body);
    await audit(body.folderId !== undefined ? "ファイルを移動" : body.expiresOn !== undefined ? "書類の期限を設定" : "ファイルの情報を変更", file.name);
    return NextResponse.json(file);
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const companyId = await requireCompanyId();
  const { id } = await params;
  try {
    const name = await deleteFile(companyId, id);
    await audit("書類フォルダのファイルを削除", name);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}

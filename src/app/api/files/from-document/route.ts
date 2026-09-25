import { NextResponse } from "next/server";
import { requireCompanyId, requireUser } from "@/lib/auth/session";
import { copyDocumentToFolder } from "@/lib/files";
import { audit } from "@/lib/audit";
import { UserError } from "@/lib/errors";

// 証憑の検索画面から、領収書・請求書の画像を書類フォルダにコピーする
export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const user = await requireUser();
  const body = await request.json().catch(() => ({}));
  try {
    const file = await copyDocumentToFolder(companyId, {
      kind: String(body.kind ?? ""),
      id: String(body.id ?? ""),
      folderId: body.folderId ? String(body.folderId) : null,
      uploadedByName: user.name,
    });
    await audit("証憑を書類フォルダに保存", file.name);
    return NextResponse.json(file, { status: 201 });
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}

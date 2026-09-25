import { NextResponse } from "next/server";
import { requireCompanyId, requireUser } from "@/lib/auth/session";
import { saveFile } from "@/lib/files";
import { audit } from "@/lib/audit";
import { UserError } from "@/lib/errors";

// ファイルを1つ保存する(複数あるときは画面から1つずつ送る)
export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const user = await requireUser();
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "ファイルを選んでください" }, { status: 400 });
  const folderId = String(form?.get("folderId") ?? "") || null;
  try {
    const saved = await saveFile(companyId, { file, folderId, uploadedByName: user.name });
    await audit("書類フォルダにファイルを保存", saved.name);
    return NextResponse.json(saved, { status: 201 });
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}

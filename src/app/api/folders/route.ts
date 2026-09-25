import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { allFolders, createFolder, listFolder } from "@/lib/files";
import { audit } from "@/lib/audit";
import { UserError } from "@/lib/errors";

// ?folder=ID のフォルダの中身(指定なしなら、いちばん上の階層)
export async function GET(request: Request) {
  const companyId = await requireCompanyId();
  const folderId = new URL(request.url).searchParams.get("folder") || null;
  try {
    const [listing, folders] = await Promise.all([listFolder(companyId, folderId), allFolders(companyId)]);
    return NextResponse.json({ ...listing, allFolders: folders });
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}

export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  try {
    const folder = await createFolder(companyId, body);
    await audit("フォルダを作成", folder.name);
    return NextResponse.json(folder, { status: 201 });
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}

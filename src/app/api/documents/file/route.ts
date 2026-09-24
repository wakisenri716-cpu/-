import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { getDocumentFile } from "@/lib/documents";

// 保存している画像は画像として返す(画像以外はダウンロードさせる)
const INLINE = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf"]);

export async function GET(request: Request) {
  const companyId = await requireCompanyId();
  const q = new URL(request.url).searchParams;
  const file = await getDocumentFile(companyId, q.get("kind") ?? "", q.get("id") ?? "");
  if (!file) return NextResponse.json({ error: "ファイルが見つかりません" }, { status: 404 });
  const inline = INLINE.has(file.mediaType);
  return new NextResponse(new Uint8Array(file.body), {
    headers: {
      "Content-Type": inline ? file.mediaType : "application/octet-stream",
      "Content-Disposition": inline ? "inline" : "attachment",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=3600",
    },
  });
}

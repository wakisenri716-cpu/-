import { NextResponse } from "next/server";
import { adminOr403 } from "@/lib/auth/users";
import { buildBackup } from "@/lib/backup";
import { audit } from "@/lib/audit";
import { jstDateKey } from "@/lib/jst";

// 全データのバックアップは管理者だけがダウンロードできる
export async function GET() {
  const admin = await adminOr403();
  if (admin instanceof NextResponse) return admin;
  const zip = await buildBackup(admin.companyId);
  await audit("データをバックアップ", `${Math.round(zip.length / 1024)}KB`);
  const name = `backup_${jstDateKey(new Date())}.zip`;
  return new NextResponse(new Uint8Array(zip), {
    headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" },
  });
}

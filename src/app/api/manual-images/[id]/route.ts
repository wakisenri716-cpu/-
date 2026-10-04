import { NextResponse } from "next/server";
import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { deleteImage, getImage } from "@/lib/manuals";
import { audit } from "@/lib/audit";

type Params = { params: Promise<{ id: string }> };

// マニュアルの写真(同じ会社のメンバーだけ見られる)
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const user = await requireMember();
  const image = await getImage(user.companyId, id, user.role !== "EMPLOYEE");
  if (!image) return NextResponse.json({ error: "写真が見つかりません" }, { status: 404 });
  return new Response(new Uint8Array(image.data), { headers: { "Content-Type": image.mimeType, "Cache-Control": "private, max-age=3600" } });
}

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  return respond(async () => {
    const image = await deleteImage(companyId, id);
    await audit("マニュアルの写真を削除", image.manual.title);
    return { ok: true };
  });
}

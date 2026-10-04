import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { addImage } from "@/lib/manuals";
import { audit } from "@/lib/audit";

// 写真を足す(フォームの file と caption)
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "写真を選んでください" }, { status: 400 });
  return respond(async () => {
    const r = await addImage(companyId, id, file, form?.get("caption"));
    await audit("マニュアルに写真を追加", r.manual.title);
    return { id: r.id };
  }, 201);
}

import { NextResponse } from "next/server";
import { requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { getManualForUser, markRead } from "@/lib/manuals";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const user = await requireMember();
  // 管理者・経理担当は、下書き(非公開)も確かめられる
  const manual = await getManualForUser(user.companyId, user.id, id, user.role !== "EMPLOYEE");
  if (!manual) return NextResponse.json({ error: "マニュアルが見つかりません" }, { status: 404 });
  return NextResponse.json(manual);
}

// 「読みました」
export async function POST(_request: Request, { params }: Params) {
  const { id } = await params;
  const user = await requireMember();
  return respond(async () => {
    await markRead(user.companyId, user.id, id);
    return { ok: true };
  });
}

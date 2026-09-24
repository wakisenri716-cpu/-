import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit";

// 指定した端末をログアウトさせる(自分のセッションだけ)
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const { count } = await prisma.session.deleteMany({ where: { id, userId: user.id } });
  if (!count) return NextResponse.json({ error: "端末が見つかりません" }, { status: 404 });
  await audit("端末をログアウト", null, user);
  return NextResponse.json({ ok: true });
}

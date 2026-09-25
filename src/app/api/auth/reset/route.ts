import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resetPassword } from "@/lib/auth/passwordReset";
import { audit } from "@/lib/audit";
import { UserError } from "@/lib/errors";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  try {
    const userId = await resetPassword(body.token, body.password);
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, companyId: true, name: true } });
    if (user) await audit("パスワードをメールで再設定", null, user);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}

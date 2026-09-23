import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/auth/password";
import { createSession, requireUser } from "@/lib/auth/session";

export async function POST(request: Request) {
  const user = await requireUser();
  const body = await request.json().catch(() => ({}));
  const current = String(body.currentPassword ?? "");
  const next = String(body.newPassword ?? "");

  if (!user.passwordHash || !(await verifyPassword(current, user.passwordHash))) {
    return NextResponse.json({ error: "今のパスワードが違います" }, { status: 400 });
  }
  const problem = passwordProblem(next);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  // パスワードを変えたら、ほかの端末のログインはすべて無効にする
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(next) } }),
    prisma.session.deleteMany({ where: { userId: user.id } }),
  ]);
  await createSession(user.id);
  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { burnPasswordCheck, verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";

const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;
const INVALID = "メールアドレスまたはパスワードが違います";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  if (!email || !password) {
    return NextResponse.json({ error: "メールアドレスとパスワードを入力してください" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user?.passwordHash || !user.active) {
    await burnPasswordCheck(password);
    return NextResponse.json({ error: INVALID }, { status: 401 });
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    return NextResponse.json(
      { error: `ログインの失敗が続いたため、${LOCK_MINUTES}分間ロックしています。しばらくしてからお試しください` },
      { status: 429 },
    );
  }

  if (!(await verifyPassword(password, user.passwordHash))) {
    const failures = user.failedLogins + 1;
    const lock = failures >= MAX_FAILURES;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLogins: lock ? 0 : failures,
        lockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : user.lockedUntil,
      },
    });
    return NextResponse.json({ error: INVALID }, { status: 401 });
  }

  await prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });
  await prisma.session.deleteMany({ where: { userId: user.id, expiresAt: { lt: new Date() } } });
  await createSession(user.id);
  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { burnPasswordCheck, verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { consumeRecoveryCode, verifyTotp } from "@/lib/auth/totp";

const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;
const INVALID = "メールアドレスまたはパスワードが違います";

// パスワード・確認コードの失敗を数え、続いたらロックする
async function recordFailure(user: { id: string; failedLogins: number; lockedUntil: Date | null }) {
  const failures = user.failedLogins + 1;
  const lock = failures >= MAX_FAILURES;
  await prisma.user.update({
    where: { id: user.id },
    data: {
      failedLogins: lock ? 0 : failures,
      lockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : user.lockedUntil,
    },
  });
}

// 2段階認証: 認証アプリの6桁コード、または回復コードを確認する。同じコードの使い回しは受け付けない。
async function checkSecondFactor(user: { id: string; totpSecret: string | null; totpLastStep: number | null; recoveryCodes: string | null }, code: string) {
  if (!user.totpSecret) return null;
  const step = verifyTotp(user.totpSecret, code, user.totpLastStep);
  if (step !== null) {
    const claimed = await prisma.user.updateMany({
      where: { id: user.id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
      data: { totpLastStep: step },
    });
    return claimed.count === 1 ? "totp" : null;
  }
  const remaining = consumeRecoveryCode(user.recoveryCodes, code);
  if (remaining === null) return null;
  const used = await prisma.user.updateMany({ where: { id: user.id, recoveryCodes: user.recoveryCodes }, data: { recoveryCodes: remaining } });
  return used.count === 1 ? "recovery" : null;
}

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
    await recordFailure(user);
    return NextResponse.json({ error: INVALID }, { status: 401 });
  }

  let usedRecovery = false;
  if (user.totpEnabled) {
    const code = String(body.code ?? "").trim();
    // パスワードは合っているので、画面に確認コードの入力欄を出してもらう(まだログインさせない)
    if (!code) return NextResponse.json({ totpRequired: true });
    const factor = await checkSecondFactor(user, code);
    if (!factor) {
      await recordFailure(user);
      return NextResponse.json({ error: "確認コードが違います", totpRequired: true }, { status: 401 });
    }
    usedRecovery = factor === "recovery";
  }

  await prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });
  await prisma.session.deleteMany({ where: { userId: user.id, expiresAt: { lt: new Date() } } });
  await createSession(user.id);
  await audit(usedRecovery ? "回復コードでログイン" : "ログイン", null, user);
  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { pickMembership } from "@/lib/auth/companies";
import { clientIp, deviceId, deviceLabel } from "@/lib/security";
import { appUrl, sendMail } from "@/lib/mail";
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
  // どの会社でも利用停止されている人はログインできない
  const member = user ? await pickMembership(user, null) : null;
  if (!user?.passwordHash || !user.active || !member) {
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

  // IPアドレス制限: この場所から開ける会社がなければログインさせない
  const ip = clientIp(request.headers);
  const allowed = await pickMembership(user, null, ip);
  if (!allowed) {
    await audit("ログインを拒否(IPアドレス制限)", `IP ${ip ?? "不明"}`, { ...user, companyId: member.companyId });
    return NextResponse.json({ error: `この場所(IPアドレス ${ip ?? "不明"})からはログインできません。会社の管理者に確認してください` }, { status: 403 });
  }

  await prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });
  await prisma.session.deleteMany({ where: { userId: user.id, expiresAt: { lt: new Date() } } });
  await createSession(user.id, allowed.companyId);

  // 新しい端末からのログインなら、本人にメールで知らせる(会社の設定で有効なとき。初めてのログインは除く)
  const userAgent = request.headers.get("user-agent");
  const device = deviceId(userAgent);
  const [before, sameDevice] = await Promise.all([
    prisma.auditLog.count({ where: { userId: user.id, action: { in: ["ログイン", "回復コードでログイン"] } } }),
    prisma.auditLog.count({ where: { userId: user.id, action: { in: ["ログイン", "回復コードでログイン"] }, detail: { contains: `端末ID ${device}` } } }),
  ]);
  const detail = `${deviceLabel(userAgent)}(端末ID ${device}) IP ${ip ?? "不明"}`;
  await audit(usedRecovery ? "回復コードでログイン" : "ログイン", detail, { ...user, companyId: allowed.companyId });
  if (allowed.company.loginAlert && before > 0 && sameDevice === 0) {
    const when = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", dateStyle: "medium", timeStyle: "short" }).format(new Date());
    await sendMail({
      companyId: allowed.companyId,
      kind: "SECURITY",
      to: user.email,
      subject: "【経理AI】新しい端末からログインがありました",
      text: [
        `${user.name}さん`,
        "",
        "あなたのアカウントに、これまで使っていない端末からログインがありました。",
        "",
        `日時: ${when}`,
        `端末: ${deviceLabel(userAgent)}`,
        `IPアドレス: ${ip ?? "不明"}`,
        "",
        "ご本人なら、このメールは気にしなくて大丈夫です。",
        "心当たりがなければ、すぐにパスワードを変えて、「アカウント」の「ログイン中の端末」から知らない端末をログアウトさせてください。",
        `${appUrl(request)}/account`,
      ].join("\n"),
      sentByName: "システム",
      relatedId: user.id,
    }).catch(() => {});
  }
  return NextResponse.json({ ok: true });
}

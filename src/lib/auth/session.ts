import { createHash, randomBytes } from "crypto";
import { billingState } from "@/lib/billing";
import { verificationRequired } from "./emailVerification";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { pickMembership } from "./companies";
import { clientIp } from "@/lib/security";
import { TERMS_VERSION } from "@/lib/legal";

export const SESSION_COOKIE = "session";
const SESSION_DAYS = 30;

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

// companyId: このログインで開く会社(パスワード変更のときに、開いていた会社を引き継ぐ)
export async function createSession(userId: string, companyId: string | null = null) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  const userAgent = (await headers()).get("user-agent")?.slice(0, 300) ?? null;
  await prisma.session.create({ data: { tokenHash: hashToken(token), userId, companyId, expiresAt, userAgent, lastSeenAt: new Date() } });
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  cookieStore.delete(SESSION_COOKIE);
}

// 1回の描画・リクエストの中では何度呼んでもDBを1回しか引かないよう cache する
export const getCurrentUser = cache(async () => {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!session || session.expiresAt < new Date() || !session.user.active) return null;
  // 開いている会社と、その会社での権限。どの会社でも利用停止されている、または
  // IPアドレス制限でこの場所から開ける会社がなければ、ログインしていない扱い
  const ip = clientIp(await headers());
  const member = await pickMembership(session.user, session.companyId, ip);
  if (!member) return null;
  // 自動ログアウト: 開いている会社の設定の時間、操作がなければログアウトさせる
  const idle = member.company.sessionIdleMinutes;
  const last = session.lastSeenAt ?? session.createdAt;
  if (idle && Date.now() - last.getTime() > idle * 60_000) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  // 「ログイン中の端末」に最終利用日時を出すため、ときどきだけ更新する(毎回書き込まない)
  const every = Math.min(10, idle ? idle / 5 : 10) * 60_000;
  if (Date.now() - last.getTime() > every || session.companyId !== member.companyId) {
    await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date(), companyId: member.companyId } }).catch(() => {});
  }
  return {
    ...session.user,
    companyId: member.companyId,
    role: member.role,
    // 会社で2段階認証を必須にしていて、まだ設定していない
    mustSetup2fa: member.company.require2fa && !session.user.totpEnabled,
    // 利用規約・プライバシーポリシー(今の版)にまだ同意していない
    needsTerms: session.user.termsVersion !== TERMS_VERSION,
    // 管理者で、開いている会社の情報をまだ入力していない
    needsCompanyInfo: member.role === "ADMIN" && !member.company.onboardedAt,
    // 新規登録したメールアドレスをまだ確かめていない(メールを送れるときだけ)
    needsEmailVerify: !session.user.emailVerifiedAt && verificationRequired(),
    // 有料プランの状態(無料期間・契約中・期限切れ)
    billing: billingState(member.company),
  };
});

// 今使っているセッション(この端末)の ID
export async function getCurrentSessionId() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return (await prisma.session.findUnique({ where: { tokenHash: hashToken(token) }, select: { id: true } }))?.id ?? null;
}

// データを読み書きする処理はすべてここを通る。proxy のクッキー確認をすり抜けても、
// 有効なセッションがなければデータには届かない。
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

// 従業員が使える画面。これ以外(帳票・銀行・給料など)は管理者と経理担当だけ。
export const EMPLOYEE_PATHS = ["/staff", "/expenses", "/timeclock", "/worklogs", "/requests", "/notices", "/account", "/share", "/welcome", "/terms", "/privacy", "/guide", "/support", "/pricing", "/tokushoho", "/billing", "/verify-email"];

// ログインしていなくても、ようこそ画面の途中でも読める画面
export const OPEN_PATHS = ["/welcome", "/terms", "/privacy", "/guide", "/support", "/pricing", "/tokushoho", "/verify-email"];

// 従業員も使える機能(自分の経費精算・タイムカード)用。
// 2段階認証が必須なのに設定していない人は、設定するまでアカウント画面へ戻す
export async function requireMember() {
  const user = await requireUser();
  if (user.mustSetup2fa) redirect("/account?require2fa=1");
  return user;
}

// 既定はこちら: 管理者・経理担当だけがデータに届く。従業員はスタッフアプリへ戻す。
export async function requireCompanyId(): Promise<string> {
  const user = await requireMember();
  if (user.role === "EMPLOYEE") redirect("/staff");
  return user.companyId;
}

export async function requireAdmin() {
  const user = await requireMember();
  return user.role === "ADMIN" ? user : null;
}

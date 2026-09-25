import { createHash, randomBytes } from "crypto";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";

export const SESSION_COOKIE = "session";
const SESSION_DAYS = 30;

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  const userAgent = (await headers()).get("user-agent")?.slice(0, 300) ?? null;
  await prisma.session.create({ data: { tokenHash: hashToken(token), userId, expiresAt, userAgent, lastSeenAt: new Date() } });
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
  // 「ログイン中の端末」に最終利用日時を出すため、10分に1回だけ更新する(毎回書き込まない)
  if (!session.lastSeenAt || Date.now() - session.lastSeenAt.getTime() > 10 * 60_000) {
    await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
  }
  return session.user;
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
export const EMPLOYEE_PATHS = ["/expenses", "/timeclock", "/account", "/share"];

// 従業員も使える機能(自分の経費精算・タイムカード)用
export async function requireMember() {
  return requireUser();
}

// 既定はこちら: 管理者・経理担当だけがデータに届く。従業員は経費精算へ戻す。
export async function requireCompanyId(): Promise<string> {
  const user = await requireUser();
  if (user.role === "EMPLOYEE") redirect("/expenses");
  return user.companyId;
}

export async function requireAdmin() {
  const user = await requireUser();
  return user.role === "ADMIN" ? user : null;
}

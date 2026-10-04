import { prisma } from "@/lib/prisma";

// パスワードを持つユーザーが1人もいない = まだ最初の管理者が作られていない。
// この間は、ログイン画面を最初に開いた人が合言葉なしで管理者を作れる(作成後は誰も作れなくなる)。
export async function needsInitialSetup() {
  return (await prisma.user.count({ where: { passwordHash: { not: null } } })) === 0;
}

// サービスとして新規登録を受け付けるか(有料プランの設定をしたとき、または ALLOW_SIGNUP=true のとき)
export function signupOpen() {
  return !!process.env.STRIPE_SECRET_KEY || process.env.ALLOW_SIGNUP === "true";
}

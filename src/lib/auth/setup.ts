import { prisma } from "@/lib/prisma";

// パスワードを持つユーザーが1人もいない = まだ最初の管理者が作られていない。
// この間は、ログイン画面を最初に開いた人が合言葉なしで管理者を作れる(作成後は誰も作れなくなる)。
export async function needsInitialSetup() {
  return (await prisma.user.count({ where: { passwordHash: { not: null } } })) === 0;
}

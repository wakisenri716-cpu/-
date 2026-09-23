import { prisma } from "@/lib/prisma";

// パスワードを持つユーザーが1人もいない = まだ最初の管理者が作られていない
export async function needsInitialSetup() {
  return (await prisma.user.count({ where: { passwordHash: { not: null } } })) === 0;
}

// SEED_SECRET を知っている人だけが最初の管理者を作れる。本番で未設定のままだと誰でも管理者になれてしまうので、
// その場合はセットアップ自体を止める(合言葉なしで作れるのは、未設定のローカル開発環境だけ)。
export function setupSecretRequired() {
  return Boolean(process.env.SEED_SECRET) || process.env.NODE_ENV === "production";
}

export function setupBlockedReason() {
  return process.env.NODE_ENV === "production" && !process.env.SEED_SECRET
    ? "サーバーに SEED_SECRET が設定されていません。Vercel の環境変数に設定して再デプロイしてから、もう一度開いてください"
    : null;
}

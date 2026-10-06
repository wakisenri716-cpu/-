import { createHash, randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { mailMode, sendMail } from "@/lib/mail";
import { UserError } from "@/lib/errors";

// 新規登録したメールアドレスの確認。届いたメールのリンク(24時間・1回だけ有効)を開くと確認済みになる。
// メールの送信を設定していない(テストモード)ときは確かめようがないので、確認は求めない。

const VALID_HOURS = 24;
const MAX_PER_HOUR = 5;
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export function verificationRequired() {
  return mailMode() !== "test";
}

export async function sendVerification(userId: string, baseUrl: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true, companyId: true, emailVerifiedAt: true } });
  if (!user || user.emailVerifiedAt) return;
  const recent = await prisma.emailVerification.count({ where: { userId, createdAt: { gte: new Date(Date.now() - 3_600_000) } } });
  if (recent >= MAX_PER_HOUR) throw new UserError("確認のメールを送りすぎています。1時間ほどしてからもう一度お試しください");
  const token = randomBytes(32).toString("base64url");
  await prisma.emailVerification.create({ data: { userId, tokenHash: hash(token), expiresAt: new Date(Date.now() + VALID_HOURS * 3_600_000) } });
  const intro = [`${user.name} さん`, "", "Clerkly にご登録いただき、ありがとうございます。", `下記のリンクを開いて、メールアドレスの確認を済ませてください(${VALID_HOURS}時間有効)。`, ""];
  const outro = ["", "このメールに心当たりがない場合は、何もしなくて大丈夫です。"];
  await sendMail({
    companyId: user.companyId,
    kind: "VERIFY",
    to: user.email,
    subject: "【Clerkly】メールアドレスの確認",
    text: [...intro, `${baseUrl}/verify-email?token=${token}`, ...outro].join("\n"),
    logBody: [...intro, "(確認のリンクは安全のため記録していません)", ...outro].join("\n"),
    sentByName: "システム",
    relatedId: user.id,
  });
}

// リンクを開いたとき: 確認済みにして、その人の名前を返す(使えないリンクなら null)
export async function verifyEmail(tokenInput: unknown) {
  const token = String(tokenInput ?? "");
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const row = await prisma.emailVerification.findUnique({ where: { tokenHash: hash(token) }, include: { user: { select: { id: true, name: true, emailVerifiedAt: true } } } });
  if (!row || row.expiresAt < new Date()) return null;
  if (row.usedAt || row.user.emailVerifiedAt) return { name: row.user.name, already: true };
  await prisma.$transaction([
    prisma.emailVerification.updateMany({ where: { userId: row.userId, usedAt: null }, data: { usedAt: new Date() } }),
    prisma.user.update({ where: { id: row.userId }, data: { emailVerifiedAt: new Date() } }),
  ]);
  return { name: row.user.name, already: false };
}

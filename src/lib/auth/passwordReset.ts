import { createHash, randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { hashPassword, passwordProblem } from "@/lib/auth/password";
import { mailMode, sendMail } from "@/lib/mail";
import { UserError } from "@/lib/errors";

// パスワードを忘れたときの再設定。メールで送ったリンク(1時間・1回だけ有効)から新しいパスワードを決める。
// 登録されているかどうかを他人に知られないよう、画面の応答はいつも同じにする。

export class ResetError extends UserError {}

const VALID_MINUTES = 60;
const MAX_PER_HOUR = 3;
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function requestPasswordReset(emailInput: unknown, baseUrl: string) {
  const email = String(emailInput ?? "").trim().toLowerCase().slice(0, 254);
  if (!email || mailMode() === "test") return;
  const user = await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" }, active: true } });
  if (!user) return;
  const recent = await prisma.passwordReset.count({ where: { userId: user.id, createdAt: { gte: new Date(Date.now() - 3_600_000) } } });
  if (recent >= MAX_PER_HOUR) return;

  const token = randomBytes(32).toString("base64url");
  await prisma.passwordReset.create({ data: { userId: user.id, tokenHash: hash(token), expiresAt: new Date(Date.now() + VALID_MINUTES * 60_000) } });
  const intro = [`${user.name} さん`, "", "経理AIのパスワード再設定のご依頼を受け付けました。", `下記のリンクから、${VALID_MINUTES}分以内に新しいパスワードを設定してください。`, ""];
  const outro = ["", "このメールに心当たりがない場合は、何もしなくて大丈夫です(パスワードは変わりません)。"];
  await sendMail({
    companyId: user.companyId,
    kind: "PASSWORD_RESET",
    to: user.email,
    subject: "【経理AI】パスワード再設定のご案内",
    text: [...intro, `${baseUrl}/reset-password?token=${token}`, ...outro].join("\n"),
    // 記録を見られる人がリンクを使えないよう、履歴にはリンクを残さない
    logBody: [...intro, "(再設定のリンクは安全のため記録していません)", ...outro].join("\n"),
    sentByName: "システム",
    relatedId: user.id,
  });
}

export async function checkResetToken(token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const reset = await prisma.passwordReset.findUnique({ where: { tokenHash: hash(token) }, include: { user: { select: { id: true, active: true, name: true } } } });
  if (!reset || reset.usedAt || reset.expiresAt < new Date() || !reset.user.active) return null;
  return reset;
}

export async function resetPassword(tokenInput: unknown, passwordInput: unknown) {
  const token = String(tokenInput ?? "");
  const password = String(passwordInput ?? "");
  const reset = await checkResetToken(token);
  if (!reset) throw new ResetError("このリンクは使えません(期限切れか、すでに使われています)。もう一度、再設定のメールを送ってください");
  const problem = passwordProblem(password);
  if (problem) throw new ResetError(problem);
  const passwordHash = await hashPassword(password);
  await prisma.$transaction(async (tx) => {
    // 2回押されても1回分しか使えないよう、未使用であることを条件に使用済みにする
    const claimed = await tx.passwordReset.updateMany({ where: { id: reset.id, usedAt: null }, data: { usedAt: new Date() } });
    if (claimed.count !== 1) throw new ResetError("このリンクはすでに使われています");
    await tx.user.update({ where: { id: reset.userId }, data: { passwordHash, failedLogins: 0, lockedUntil: null } });
    // ほかの端末のログインと、残っている再設定リンクはすべて無効にする
    await tx.session.deleteMany({ where: { userId: reset.userId } });
    await tx.passwordReset.updateMany({ where: { userId: reset.userId, usedAt: null }, data: { usedAt: new Date() } });
  });
  return reset.userId;
}

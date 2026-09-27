import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/session";
import { verifyPassword } from "@/lib/auth/password";
import { audit } from "@/lib/audit";

// 無効にするときは、本人確認としてパスワードを求める
export async function POST(request: Request) {
  const user = await requireUser();
  const body = await request.json().catch(() => ({}));
  if (!user.totpEnabled) return NextResponse.json({ error: "2段階認証は有効になっていません" }, { status: 400 });
  // 入っている会社のどれかで必須にしていれば、解除できない
  const required = await prisma.companyMember.findFirst({ where: { userId: user.id, active: true, company: { require2fa: true } }, include: { company: { select: { name: true } } } });
  if (required) return NextResponse.json({ error: `「${required.company.name}」の設定で2段階認証が必須のため、解除できません` }, { status: 400 });
  if (!user.passwordHash || !(await verifyPassword(String(body.password ?? ""), user.passwordHash))) {
    return NextResponse.json({ error: "パスワードが違います" }, { status: 400 });
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { totpEnabled: false, totpSecret: null, totpPendingSecret: null, totpLastStep: null, recoveryCodes: null },
  });
  await audit("2段階認証を無効化", null, user);
  return NextResponse.json({ ok: true });
}

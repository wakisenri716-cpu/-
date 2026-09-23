import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword, passwordProblem } from "@/lib/auth/password";
import { adminOr403, PUBLIC_USER_FIELDS, ROLES, toPublicUser } from "@/lib/auth/users";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await adminOr403();
  if (admin instanceof NextResponse) return admin;
  const { id } = await params;
  const target = await prisma.user.findFirst({ where: { id, companyId: admin.companyId } });
  if (!target) return NextResponse.json({ error: "ユーザーが見つかりません" }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const role = body.role === undefined ? undefined : ROLES.find((r) => r === body.role);
  if (body.role !== undefined && !role) return NextResponse.json({ error: "権限が正しくありません" }, { status: 400 });
  const active = typeof body.active === "boolean" ? body.active : undefined;
  const password = body.password === undefined ? undefined : String(body.password);

  // 自分自身を管理者から外したり停止したりすると、誰も管理できなくなるので禁止する
  if (target.id === admin.id && ((role && role !== "ADMIN") || active === false)) {
    return NextResponse.json({ error: "自分自身の管理者権限を外したり、停止したりはできません" }, { status: 400 });
  }
  if (password !== undefined) {
    const problem = passwordProblem(password);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });
  }

  const user = await prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id },
      data: {
        ...(role ? { role } : {}),
        ...(active !== undefined ? { active } : {}),
        ...(password !== undefined ? { passwordHash: await hashPassword(password), failedLogins: 0, lockedUntil: null } : {}),
      },
      select: PUBLIC_USER_FIELDS,
    });
    // 停止・パスワード再設定をしたら、その人のログイン中の端末はすべてログアウトさせる
    if (active === false || password !== undefined) await tx.session.deleteMany({ where: { userId: id } });
    return updated;
  });
  return NextResponse.json(toPublicUser(user));
}

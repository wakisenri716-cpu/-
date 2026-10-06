import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword, passwordProblem } from "@/lib/auth/password";
import { adminOr403, PUBLIC_USER_FIELDS, ROLES, toPublicUser } from "@/lib/auth/users";
import { audit } from "@/lib/audit";
import { checkSeat } from "@/lib/billing";
import { UserError } from "@/lib/errors";

const ROLE_LABELS = { ADMIN: "管理者", ACCOUNTANT: "経理担当", EMPLOYEE: "従業員", ADVISOR: "税理士(閲覧のみ)" } as const;

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await adminOr403();
  if (admin instanceof NextResponse) return admin;
  const { id } = await params;
  const member = await prisma.companyMember.findUnique({
    where: { userId_companyId: { userId: id, companyId: admin.companyId } },
    include: { user: { include: { _count: { select: { memberships: true } } } } },
  });
  if (!member) return NextResponse.json({ error: "ユーザーが見つかりません" }, { status: 404 });
  const target = member.user;

  const body = await request.json().catch(() => ({}));
  const role = body.role === undefined ? undefined : ROLES.find((r) => r === body.role);
  if (body.role !== undefined && !role) return NextResponse.json({ error: "権限が正しくありません" }, { status: 400 });
  const active = typeof body.active === "boolean" ? body.active : undefined;
  const password = body.password === undefined ? undefined : String(body.password);
  // スマホをなくした人の2段階認証を管理者が解除する(本人は次のログインから設定し直せる)
  const resetTotp = body.resetTotp === true;

  // 自分自身を管理者から外したり停止したりすると、誰も管理できなくなるので禁止する
  if (target.id === admin.id && ((role && role !== "ADMIN") || active === false)) {
    return NextResponse.json({ error: "自分自身の管理者権限を外したり、停止したりはできません" }, { status: 400 });
  }
  // 従業員から管理者・経理担当にする・利用停止から戻すときは、ライトプランの人数の上限を確かめる
  const nextRole = role ?? member.role;
  if ((role && role !== "EMPLOYEE" && member.role === "EMPLOYEE") || (active === true && !member.active && nextRole !== "EMPLOYEE")) {
    try {
      await checkSeat(admin.companyId, nextRole, target.id);
    } catch (error) {
      if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
      throw error;
    }
  }
  // パスワードと2段階認証はアカウント全体の設定なので、ほかの会社にも入っている人のものは変えない
  if ((password !== undefined || resetTotp) && (target.companyId !== admin.companyId || target._count.memberships > 1)) {
    return NextResponse.json({ error: "ほかの会社にも入っている人のパスワード・2段階認証は、ここでは変えられません。本人に「パスワードを忘れた方」から再設定してもらってください" }, { status: 400 });
  }
  if (password !== undefined) {
    const problem = passwordProblem(password);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });
  }

  const user = await prisma.$transaction(async (tx) => {
    // 権限・利用停止はこの会社の中だけ(ほかの会社での権限は変わらない)
    const updatedMember = await tx.companyMember.update({
      where: { id: member.id },
      data: { ...(role ? { role } : {}), ...(active !== undefined ? { active } : {}) },
    });
    // 最初の会社の権限は、User にも同じ値を残しておく
    const updated = await tx.user.update({
      where: { id },
      data: {
        ...(role && target.companyId === admin.companyId ? { role } : {}),
        ...(password !== undefined ? { passwordHash: await hashPassword(password), failedLogins: 0, lockedUntil: null } : {}),
        ...(resetTotp ? { totpEnabled: false, totpSecret: null, totpPendingSecret: null, totpLastStep: null, recoveryCodes: null } : {}),
      },
      select: PUBLIC_USER_FIELDS,
    });
    // パスワード再設定などをしたら、すべての端末をログアウトさせる。
    // この会社で停止したときは、この会社を開いている端末をほかの会社に切り替える(ほかの会社がなければログアウトと同じ)
    if (password !== undefined || resetTotp) await tx.session.deleteMany({ where: { userId: id } });
    else if (active === false) await tx.session.updateMany({ where: { userId: id, companyId: admin.companyId }, data: { companyId: null } });
    return { ...updated, role: updatedMember.role, active: updatedMember.active };
  });
  const changes = [
    role ? `権限を${ROLE_LABELS[role]}に変更` : null,
    active === false ? "利用停止" : active === true ? "利用再開" : null,
    password !== undefined ? "パスワード再設定" : null,
    resetTotp ? "2段階認証を解除" : null,
  ].filter(Boolean);
  if (changes.length) await audit("ユーザー変更", `${target.name}: ${changes.join("・")}`);
  return NextResponse.json(toPublicUser(user));
}

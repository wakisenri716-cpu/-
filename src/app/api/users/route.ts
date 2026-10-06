import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword, passwordProblem } from "@/lib/auth/password";
import { adminOr403, PUBLIC_USER_FIELDS, ROLES, toPublicUser } from "@/lib/auth/users";
import { audit } from "@/lib/audit";
import { checkSeat } from "@/lib/billing";
import { UserError } from "@/lib/errors";

const ROLE_LABELS = { ADMIN: "管理者", ACCOUNTANT: "経理担当", EMPLOYEE: "従業員", ADVISOR: "税理士(閲覧のみ)" } as const;

// この会社のメンバー(権限・利用停止は会社ごと)
export async function GET() {
  const admin = await adminOr403();
  if (admin instanceof NextResponse) return admin;
  const members = await prisma.companyMember.findMany({
    where: { companyId: admin.companyId },
    include: { user: { select: { ...PUBLIC_USER_FIELDS, companyId: true, _count: { select: { memberships: true } } } } },
    orderBy: [{ active: "desc" }, { createdAt: "asc" }],
  });
  return NextResponse.json(
    members.map(({ user: { companyId, _count, ...user }, role, active }) => ({
      ...toPublicUser(user),
      role,
      active,
      // ほかの会社にも入っている人(パスワードの再設定などは本人がする)
      otherCompanies: _count.memberships - 1,
      homeCompany: companyId === admin.companyId,
    })),
  );
}

export async function POST(request: Request) {
  const admin = await adminOr403();
  if (admin instanceof NextResponse) return admin;
  const body = await request.json().catch(() => ({}));
  const name = String(body.name ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const role = ROLES.find((r) => r === body.role) ?? "EMPLOYEE";

  if (!/^[^\s@]+@[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "有効なメールアドレスを入力してください" }, { status: 400 });
  }
  const existing = await prisma.user.findUnique({
    where: { email },
    select: { ...PUBLIC_USER_FIELDS, companyId: true, memberships: { where: { companyId: admin.companyId }, select: { id: true } } },
  });

  // ライトプランは管理者・経理担当の人数に上限がある
  try {
    await checkSeat(admin.companyId, role);
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
  // すでにアカウントがある人(ほかの会社のメンバー)は、今のパスワードのまま、この会社のメンバーに加える
  if (existing?.passwordHash) {
    if (existing.memberships.length) return NextResponse.json({ error: "この人はすでにこの会社のメンバーです" }, { status: 409 });
    await prisma.companyMember.create({ data: { userId: existing.id, companyId: admin.companyId, role } });
    await audit("ユーザー追加", `${existing.name}(${email}) を ${ROLE_LABELS[role]} として追加(ほかの会社のアカウント)`);
    const { memberships: _m, companyId: _c, ...fields } = existing;
    void _m;
    void _c;
    return NextResponse.json({ ...toPublicUser({ ...fields, role, active: true }), joined: true }, { status: 201 });
  }
  if (!name) return NextResponse.json({ error: "名前を入力してください" }, { status: 400 });
  const problem = passwordProblem(password);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });
  if (existing && existing.companyId !== admin.companyId) {
    return NextResponse.json({ error: "このメールアドレスはすでに登録されています" }, { status: 409 });
  }
  // 以前の仮ログインで作られた(パスワード未設定の)ユーザーは、経費精算などの履歴を残したままパスワードを設定する
  const user = await prisma.$transaction(async (tx) => {
    const saved = await tx.user.upsert({
      where: { email },
      update: { name, role, passwordHash: await hashPassword(password), active: true },
      create: { companyId: admin.companyId, name, email, role, passwordHash: await hashPassword(password) },
      select: PUBLIC_USER_FIELDS,
    });
    await tx.companyMember.upsert({
      where: { userId_companyId: { userId: saved.id, companyId: admin.companyId } },
      update: { role, active: true },
      create: { userId: saved.id, companyId: admin.companyId, role },
    });
    return saved;
  });
  await audit("ユーザー追加", `${name}(${email}) を ${ROLE_LABELS[role]} として追加`);
  return NextResponse.json(toPublicUser(user), { status: 201 });
}

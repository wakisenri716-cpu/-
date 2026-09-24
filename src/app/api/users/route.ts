import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword, passwordProblem } from "@/lib/auth/password";
import { adminOr403, PUBLIC_USER_FIELDS, ROLES, toPublicUser } from "@/lib/auth/users";
import { audit } from "@/lib/audit";

const ROLE_LABELS = { ADMIN: "管理者", ACCOUNTANT: "経理担当", EMPLOYEE: "従業員" } as const;

export async function GET() {
  const admin = await adminOr403();
  if (admin instanceof NextResponse) return admin;
  const users = await prisma.user.findMany({
    where: { companyId: admin.companyId },
    select: PUBLIC_USER_FIELDS,
    orderBy: [{ active: "desc" }, { createdAt: "asc" }],
  });
  return NextResponse.json(users.map(toPublicUser));
}

export async function POST(request: Request) {
  const admin = await adminOr403();
  if (admin instanceof NextResponse) return admin;
  const body = await request.json().catch(() => ({}));
  const name = String(body.name ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const role = ROLES.find((r) => r === body.role) ?? "EMPLOYEE";

  if (!name || !/^[^\s@]+@[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "名前と有効なメールアドレスを入力してください" }, { status: 400 });
  }
  const problem = passwordProblem(password);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing?.passwordHash) {
    return NextResponse.json({ error: "このメールアドレスはすでに登録されています" }, { status: 409 });
  }
  if (existing && existing.companyId !== admin.companyId) {
    return NextResponse.json({ error: "このメールアドレスはすでに登録されています" }, { status: 409 });
  }
  // 以前の仮ログインで作られた(パスワード未設定の)ユーザーは、経費精算などの履歴を残したままパスワードを設定する
  const user = await prisma.user.upsert({
    where: { email },
    update: { name, role, passwordHash: await hashPassword(password), active: true },
    create: { companyId: admin.companyId, name, email, role, passwordHash: await hashPassword(password) },
    select: PUBLIC_USER_FIELDS,
  });
  await audit("ユーザー追加", `${name}(${email}) を ${ROLE_LABELS[role]} として追加`);
  return NextResponse.json(toPublicUser(user), { status: 201 });
}

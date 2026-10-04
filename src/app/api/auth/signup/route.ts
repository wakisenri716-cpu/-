import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword, passwordProblem } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { signupOpen } from "@/lib/auth/setup";
import { ensureChartOfAccounts } from "@/lib/accounting/accounts";
import { acceptTerms, agreed, parseCompanyOnboarding, saveCompanyOnboarding } from "@/lib/onboarding";
import { UserError } from "@/lib/errors";

// 1時間に受け付ける新規登録の上限(いたずらで大量に作られないように)
const HOURLY_LIMIT = 30;

// 新しい会社と、その管理者のアカウントを作る(無料期間から始まる)
export async function POST(request: Request) {
  if (!signupOpen()) return NextResponse.json({ error: "現在、新規登録は受け付けていません" }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const name = String(body.name ?? "").trim().slice(0, 60);
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "名前と有効なメールアドレスを入力してください" }, { status: 400 });
  const problem = passwordProblem(password);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });
  if (!agreed(body.agree)) return NextResponse.json({ error: "利用規約とプライバシーポリシーに同意してください" }, { status: 400 });
  try {
    parseCompanyOnboarding(body);
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
  if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
    return NextResponse.json({ error: "このメールアドレスはすでに登録されています。ログインしてください(ほかの会社も使うときは、ログイン後に会社を追加できます)" }, { status: 409 });
  }
  if ((await prisma.company.count({ where: { createdAt: { gte: new Date(Date.now() - 3_600_000) } } })) >= HOURLY_LIMIT) {
    return NextResponse.json({ error: "ただいま登録が混み合っています。しばらくしてからもう一度お試しください" }, { status: 429 });
  }

  const passwordHash = await hashPassword(password);
  let created;
  try {
    created = await prisma.$transaction(async (tx) => {
      const company = await tx.company.create({ data: { name: String(body.companyName ?? "").trim().slice(0, 100) || name } });
      const user = await tx.user.create({ data: { companyId: company.id, name, email, role: "ADMIN", passwordHash } });
      await tx.companyMember.create({ data: { userId: user.id, companyId: company.id, role: "ADMIN" } });
      return { company, user };
    });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return NextResponse.json({ error: "このメールアドレスはすでに登録されています" }, { status: 409 });
    throw error;
  }
  await ensureChartOfAccounts(created.company.id);
  await saveCompanyOnboarding(created.company.id, body);
  await acceptTerms(created.user.id);
  await createSession(created.user.id, created.company.id);
  return NextResponse.json({ ok: true }, { status: 201 });
}

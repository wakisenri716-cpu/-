import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";
import { seedDatabase } from "@/lib/seedDatabase";
import { hashPassword, passwordProblem } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { needsInitialSetup, setupBlockedReason, setupSecretRequired } from "@/lib/auth/setup";

function secretMatches(given: string) {
  const expected = Buffer.from(process.env.SEED_SECRET ?? "");
  const actual = Buffer.from(given);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function POST(request: Request) {
  if (!(await needsInitialSetup())) {
    return NextResponse.json({ error: "管理者はすでに作成されています。ログインしてください" }, { status: 409 });
  }
  const blocked = setupBlockedReason();
  if (blocked) return NextResponse.json({ error: blocked }, { status: 503 });
  const body = await request.json().catch(() => ({}));
  const name = String(body.name ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");

  if (setupSecretRequired() && !secretMatches(String(body.secret ?? ""))) {
    return NextResponse.json({ error: "セットアップ用の合言葉(SEED_SECRET)が違います" }, { status: 403 });
  }
  if (!name || !/^[^\s@]+@[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "名前と有効なメールアドレスを入力してください" }, { status: 400 });
  }
  const problem = passwordProblem(password);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  // データベースが空でも、ここで会社・勘定科目などを用意するので /api/seed を先に開く必要はない
  const { companyId } = await seedDatabase(prisma);
  const passwordHash = await hashPassword(password);
  const user = await prisma.$transaction(async (tx) => {
    if ((await tx.user.count({ where: { passwordHash: { not: null } } })) > 0) return null;
    return tx.user.upsert({
      where: { email },
      update: { name, role: "ADMIN", passwordHash, active: true },
      create: { companyId, name, email, role: "ADMIN", passwordHash },
    });
  });
  if (!user) {
    return NextResponse.json({ error: "管理者はすでに作成されています。ログインしてください" }, { status: 409 });
  }
  await createSession(user.id);
  return NextResponse.json({ ok: true }, { status: 201 });
}

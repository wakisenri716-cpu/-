import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getDefaultCompanyId } from "@/lib/demo";
import { SESSION_COOKIE } from "@/lib/auth";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const name = String(body.name || "").trim();
  const email = String(body.email || "").trim().toLowerCase();

  if (!name || !email || !email.includes("@")) {
    return NextResponse.json({ error: "名前と有効なメールアドレスを入力してください" }, { status: 400 });
  }

  const companyId = await getDefaultCompanyId();
  const user = await prisma.user.upsert({
    where: { email },
    update: { name },
    create: { companyId, name, email, role: "EMPLOYEE" },
  });

  const response = NextResponse.json({ user });
  response.cookies.set(SESSION_COOKIE, user.id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}

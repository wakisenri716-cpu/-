import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCompanyId } from "@/lib/auth/session";
import { adminOr403 } from "@/lib/auth/users";
import { fromAddress, mailMode, normalizeEmail } from "@/lib/mail";
import { audit } from "@/lib/audit";
import { UserError } from "@/lib/errors";

export async function GET() {
  const companyId = await requireCompanyId();
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { email: true, dailyDigest: true } });
  return NextResponse.json({
    ...company,
    mode: mailMode(),
    from: fromAddress() || null,
    cron: !!process.env.CRON_SECRET,
  });
}

// 返信先のメールアドレスと、毎朝の「やること」メールのオン・オフ(管理者のみ)
export async function PUT(request: Request) {
  const admin = await adminOr403();
  if (admin instanceof NextResponse) return admin;
  const body = await request.json().catch(() => ({}));
  try {
    const email = body.email === "" || body.email === null ? null : normalizeEmail(body.email);
    const saved = await prisma.company.update({
      where: { id: admin.companyId },
      data: { email, ...(typeof body.dailyDigest === "boolean" ? { dailyDigest: body.dailyDigest } : {}) },
      select: { email: true, dailyDigest: true },
    });
    await audit("メールの設定を変更", `返信先 ${saved.email ?? "なし"}・毎朝のお知らせ ${saved.dailyDigest ? "オン" : "オフ"}`);
    return NextResponse.json(saved);
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}

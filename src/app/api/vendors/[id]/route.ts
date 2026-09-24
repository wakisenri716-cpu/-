import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCompanyId } from "@/lib/auth/session";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  if (!(await prisma.vendor.findFirst({ where: { id, companyId } }))) {
    return NextResponse.json({ error: "取引先が見つかりません" }, { status: 404 });
  }
  const body = await request.json().catch(() => ({}));

  const data: { name?: string; defaultExpenseAccountId?: string | null } = {};
  if (typeof body.name === "string" && body.name.trim()) {
    data.name = body.name.trim();
  }
  if ("defaultExpenseAccountId" in body) {
    data.defaultExpenseAccountId = body.defaultExpenseAccountId || null;
    if (data.defaultExpenseAccountId && !(await prisma.account.findFirst({ where: { id: data.defaultExpenseAccountId, companyId } }))) {
      return NextResponse.json({ error: "勘定科目が見つかりません" }, { status: 400 });
    }
  }

  const vendor = await prisma.vendor.update({
    where: { id },
    data,
    include: { defaultExpenseAccount: true },
  });
  return NextResponse.json(vendor);
}

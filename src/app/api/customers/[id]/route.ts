import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCompanyId } from "@/lib/auth/session";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  if (!(await prisma.customer.findFirst({ where: { id, companyId } }))) {
    return NextResponse.json({ error: "顧客が見つかりません" }, { status: 404 });
  }
  const body = await request.json().catch(() => ({}));

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "名前を入力してください" }, { status: 400 });
  }

  const customer = await prisma.customer.update({ where: { id }, data: { name } });
  return NextResponse.json(customer);
}

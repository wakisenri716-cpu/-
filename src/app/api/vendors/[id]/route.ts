import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  const data: { name?: string; defaultExpenseAccountId?: string | null } = {};
  if (typeof body.name === "string" && body.name.trim()) {
    data.name = body.name.trim();
  }
  if ("defaultExpenseAccountId" in body) {
    data.defaultExpenseAccountId = body.defaultExpenseAccountId || null;
  }

  const vendor = await prisma.vendor.update({
    where: { id },
    data,
    include: { defaultExpenseAccount: true },
  });
  return NextResponse.json(vendor);
}

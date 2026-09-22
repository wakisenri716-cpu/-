import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "名前を入力してください" }, { status: 400 });
  }

  const customer = await prisma.customer.update({ where: { id }, data: { name } });
  return NextResponse.json(customer);
}

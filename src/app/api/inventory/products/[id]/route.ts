import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCompanyId } from "@/lib/auth/session";

// 発注点(この数以下になったら発注を促す)の設定。null で解除。
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  const value = body.reorderPoint === null || body.reorderPoint === "" ? null : Number(body.reorderPoint);
  if (value !== null && (!Number.isInteger(value) || value < 0 || value > 1_000_000)) {
    return NextResponse.json({ error: "発注点は0以上の整数で入力してください" }, { status: 400 });
  }
  const updated = await prisma.product.updateMany({ where: { id, companyId }, data: { reorderPoint: value } });
  if (updated.count !== 1) return NextResponse.json({ error: "商品が見つかりません" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { isOperator, updateCompanyBilling } from "@/lib/operator";
import { prisma } from "@/lib/prisma";

// 運営者が会社の無料期間を延ばす { extendDays } / 無料にする・戻す { billingFree }
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user || !isOperator(user.email)) return NextResponse.json({ error: "見つかりません" }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    const r = await updateCompanyBilling(id, body);
    // 運営者の操作は、自分の会社の操作ログに残す
    await prisma.auditLog.create({ data: { companyId: user.companyId, userId: user.id, userName: user.name, action: "運営者メニュー", detail: `${r.name}: ${r.detail}` } }).catch(() => {});
    return r;
  });
}

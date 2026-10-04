import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { isOperator } from "@/lib/operator";
import { prisma } from "@/lib/prisma";

// 運営者メニューの API: 運営者でなければ 404(あることも知らせない)
export async function operatorOr404() {
  const user = await getCurrentUser();
  if (!user || !isOperator(user.email)) return NextResponse.json({ error: "見つかりません" }, { status: 404 });
  return user;
}

// 運営者の操作は、運営者の会社の操作ログに残す
export async function operatorAudit(user: { id: string; name: string; companyId: string }, detail: string) {
  await prisma.auditLog.create({ data: { companyId: user.companyId, userId: user.id, userName: user.name, action: "運営者メニュー", detail } }).catch(() => {});
}

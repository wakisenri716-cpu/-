import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireMember } from "@/lib/auth/session";

// 経費精算の画面で「申請する」ボタンを出すかどうか(従業員も読める)
export async function GET() {
  const user = await requireMember();
  const company = await prisma.company.findUnique({ where: { id: user.companyId }, select: { expenseApprovalRequired: true } });
  return NextResponse.json({ required: company?.expenseApprovalRequired ?? false });
}

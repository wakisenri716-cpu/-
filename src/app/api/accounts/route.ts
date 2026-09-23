import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCompanyId } from "@/lib/auth/session";

export async function GET() {
  const companyId = await requireCompanyId();
  const accounts = await prisma.account.findMany({
    where: { companyId, category: "EXPENSE" },
    orderBy: { code: "asc" },
  });
  return NextResponse.json(accounts);
}

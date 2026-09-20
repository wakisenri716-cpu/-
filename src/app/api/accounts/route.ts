import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getDefaultCompanyId } from "@/lib/demo";

export async function GET() {
  const companyId = await getDefaultCompanyId();
  const accounts = await prisma.account.findMany({
    where: { companyId, category: "EXPENSE" },
    orderBy: { code: "asc" },
  });
  return NextResponse.json(accounts);
}

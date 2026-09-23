import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCompanyId } from "@/lib/auth/session";

export async function GET() {
  const companyId = await requireCompanyId();
  const vendors = await prisma.vendor.findMany({
    where: { companyId },
    include: { defaultExpenseAccount: true },
    orderBy: { name: "asc" },
  });
  return NextResponse.json(vendors);
}

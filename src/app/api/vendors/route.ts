import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getDefaultCompanyId } from "@/lib/demo";

export async function GET() {
  const companyId = await getDefaultCompanyId();
  const vendors = await prisma.vendor.findMany({
    where: { companyId },
    include: { defaultExpenseAccount: true },
    orderBy: { name: "asc" },
  });
  return NextResponse.json(vendors);
}

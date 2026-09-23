import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCompanyId } from "@/lib/auth/session";

export async function GET() {
  const companyId = await requireCompanyId();
  const customers = await prisma.customer.findMany({
    where: { companyId },
    orderBy: { name: "asc" },
  });
  return NextResponse.json(customers);
}

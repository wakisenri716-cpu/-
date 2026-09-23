import { prisma } from "@/lib/prisma";
import { getDefaultCompanyId } from "@/lib/demo";
import { createStaff } from "@/lib/shifts/service";
import { respond } from "@/lib/shifts/http";

export async function GET() {
  const companyId = await getDefaultCompanyId();
  return respond(() => prisma.staff.findMany({ where: { companyId }, orderBy: [{ active: "desc" }, { createdAt: "asc" }] }));
}

export async function POST(request: Request) {
  const companyId = await getDefaultCompanyId();
  const body = await request.json().catch(() => ({}));
  return respond(() => createStaff(companyId, { name: String(body.name ?? ""), hourlyWage: Number(body.hourlyWage) }), 201);
}

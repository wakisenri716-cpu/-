import { prisma } from "@/lib/prisma";
import { requireCompanyId } from "@/lib/auth/session";
import { createStaff, publicStaff } from "@/lib/shifts/service";
import { respond } from "@/lib/shifts/http";

export async function GET() {
  const companyId = await requireCompanyId();
  return respond(async () =>
    (await prisma.staff.findMany({ where: { companyId }, orderBy: [{ active: "desc" }, { createdAt: "asc" }] })).map(publicStaff),
  );
}

export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  return respond(() => createStaff(companyId, { name: String(body.name ?? ""), hourlyWage: Number(body.hourlyWage) }), 201);
}

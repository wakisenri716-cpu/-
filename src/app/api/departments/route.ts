import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { createDepartment, listDepartments } from "@/lib/accounting/departments";
import { UserError } from "@/lib/errors";
import { audit } from "@/lib/audit";

export async function GET() {
  const companyId = await requireCompanyId();
  return NextResponse.json(await listDepartments(companyId));
}

export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  try {
    const dept = await createDepartment(companyId, String(body.name ?? ""));
    await audit("部門を追加", dept.name);
    return NextResponse.json(dept, { status: 201 });
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}

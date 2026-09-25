import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { updateDepartment } from "@/lib/accounting/departments";
import { UserError } from "@/lib/errors";
import { audit } from "@/lib/audit";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  try {
    const dept = await updateDepartment(companyId, id, {
      ...(typeof body.name === "string" ? { name: body.name } : {}),
      ...(typeof body.active === "boolean" ? { active: body.active } : {}),
    });
    await audit("部門を変更", `${dept.name}${typeof body.active === "boolean" ? (body.active ? "(再開)" : "(停止)") : ""}`);
    return NextResponse.json(dept);
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}

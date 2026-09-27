import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { onlyActive, updateProject } from "@/lib/accounting/projects";
import { audit } from "@/lib/audit";
import { UserError } from "@/lib/errors";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  try {
    const project = await updateProject(companyId, id, body);
    await audit(onlyActive(body) ? (project.active ? "案件を再開" : "案件を完了") : "案件を変更", project.name);
    return NextResponse.json(project);
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}

import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { createProjectFromDeal } from "@/lib/deals";
import { audit } from "@/lib/audit";
import { UserError } from "@/lib/errors";

// 受注した商談から案件(案件別損益)を作る
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  try {
    const project = await createProjectFromDeal(companyId, id);
    await audit("商談から案件を作成", project.name);
    return NextResponse.json(project, { status: 201 });
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}

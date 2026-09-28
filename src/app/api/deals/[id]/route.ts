import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { deleteDeal, STAGES, updateDeal } from "@/lib/deals";
import { audit } from "@/lib/audit";
import { UserError } from "@/lib/errors";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  try {
    const deal = await updateDeal(companyId, id, body);
    const stage = STAGES.find((s) => s.key === deal.stage)?.label;
    await audit(body.stage !== undefined && Object.keys(body).length === 1 ? `商談を「${stage}」に移動` : "商談を変更", `${deal.customerName} ${deal.title}`);
    return NextResponse.json(deal);
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  try {
    const deal = await deleteDeal(companyId, id);
    await audit("商談を削除", `${deal.customerName} ${deal.title}`);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}

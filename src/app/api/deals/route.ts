import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { createDeal, getPipeline } from "@/lib/deals";
import { audit, yen } from "@/lib/audit";
import { UserError } from "@/lib/errors";

export async function GET() {
  const companyId = await requireCompanyId();
  return NextResponse.json(await getPipeline(companyId));
}

export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  try {
    const deal = await createDeal(companyId, body);
    await audit("商談を登録", `${deal.customerName} ${deal.title} ${yen(deal.amount)}`);
    return NextResponse.json(deal, { status: 201 });
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}

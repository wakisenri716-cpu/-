import { NextResponse } from "next/server";
import { requireMember } from "@/lib/auth/session";
import { submitExpenseReport } from "@/lib/accounting/reimbursement";
import { UserError } from "@/lib/errors";
import { audit } from "@/lib/audit";

// 本人が経費精算を申請する(従業員も使える)
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireMember();
  try {
    await submitExpenseReport(user, id);
    await audit("経費精算を申請", null, user);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}

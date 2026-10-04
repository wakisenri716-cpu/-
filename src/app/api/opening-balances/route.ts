import { requireCompanyId } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { clearOpeningBalances, getOpeningBalances, saveOpeningBalances } from "@/lib/accounting/openingBalances";
import { audit } from "@/lib/audit";

export async function GET() {
  const companyId = await requireCompanyId();
  return respond(() => getOpeningBalances(companyId));
}

// { startDate, amounts: { 科目コード: 金額 }, balanceToRetained }
export async function PUT(request: Request) {
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    const entry = await saveOpeningBalances(companyId, body);
    await audit("開始残高を登録", `使い始める日 ${body.startDate}`);
    return { id: entry.id };
  });
}

export async function DELETE() {
  const companyId = await requireCompanyId();
  return respond(async () => {
    await clearOpeningBalances(companyId);
    await audit("開始残高を取消");
    return { ok: true };
  });
}

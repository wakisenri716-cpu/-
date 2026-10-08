import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { aiReviewInvoice, checkInvoice } from "@/lib/invoiceCheck";

// 送る前チェック(決まったルール)
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const companyId = await requireCompanyId();
  const { id } = await params;
  return respond(async () => ({ issues: await checkInvoice(companyId, id) }));
}

// 送る前チェックのAIの見直し(品名・備考の書き方)
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const { id } = await params;
  return respond(async () => ({ points: await aiReviewInvoice({ id: user.id, companyId }, id) }));
}

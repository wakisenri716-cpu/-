import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { explainJournal } from "@/lib/journalExplain";

// 「この仕訳は何?」(説明は覚えておき、仕訳が変わったら作り直す。refresh で AI に説明し直してもらう)
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  return respond(() => explainJournal(companyId, user, id, { refresh: body.refresh === true }));
}

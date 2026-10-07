import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { summarizeKarte } from "@/lib/partyKarte";
import { UserError } from "@/lib/errors";

// 「この相手のいま」(ルールのまとめ、またはAIのまとめ)
export async function POST(request: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const { kind, id } = await params;
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    if (kind !== "customer" && kind !== "vendor") throw new UserError("取引先の種類が正しくありません");
    return summarizeKarte({ id: user.id, companyId }, kind, id, body?.useAi === true);
  });
}

import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { cancelProposal, executeProposal } from "@/lib/assistant/proposals";
import { appUrl } from "@/lib/mail";
import { audit } from "@/lib/audit";

// { action: "execute" | "cancel" } AIの下書きを、人が確かめて実行する / やめる
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    if (body.action === "cancel") return cancelProposal(companyId, id);
    const r = await executeProposal(companyId, user, id, appUrl(request));
    await audit("AIアシスタントの下書きを実行", `${r.summary}(${r.resultNote ?? ""})`);
    return r;
  });
}

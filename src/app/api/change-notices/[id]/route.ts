import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { decideNotice } from "@/lib/changeNotices";
import { audit } from "@/lib/audit";

// { action: "apply" | "reject", reply }
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) ?? {};
  return respond(async () => {
    const r = await decideNotice({ companyId, name: user.name, role: user.role }, id, body);
    await audit(body.action === "apply" ? "身上の変更を名簿に入れた" : "身上の変更の届け出を見送り", id);
    return r;
  });
}

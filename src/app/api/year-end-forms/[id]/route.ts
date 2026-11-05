import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { applyYearEndForm, returnYearEndForm } from "@/lib/yearEndForms";
import { audit } from "@/lib/audit";

// { action: "apply" } 年末調整に入れる / { action: "return", reason } 差し戻す
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) ?? {};
  const me = { companyId, role: user.role };
  if (body.action === "return")
    return respond(async () => {
      await returnYearEndForm(me, id, String(body.reason ?? ""));
      return { ok: true };
    });
  return respond(async () => {
    const r = await applyYearEndForm(me, id);
    await audit("年末調整の申告を入れた", `${r.year}年`);
    return r;
  });
}

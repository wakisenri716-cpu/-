import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { decideSeal, SEALS, type Seal } from "@/lib/sealUses";
import { audit } from "@/lib/audit";

// { action: "approve" | "reject" | "done", reply, doneOn }
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) ?? {};
  return respond(async () => {
    const row = await decideSeal({ id: user.id, name: user.name, companyId, role: user.role }, id, body, request);
    await audit(body.action === "done" ? "押印した" : body.action === "approve" ? "押印を認めた" : "押印を見送り", `${SEALS[row.seal as Seal]} ${row.document} ${row.copies}部(${row.requestedByName})`);
    return { seal: row };
  });
}

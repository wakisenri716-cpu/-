import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { updateSupplyRequest } from "@/lib/supplyRequests";

// 届いた・見送り: { status: "DONE" | "REJECTED", reply }
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireCompanyId();
  const user = await requireMember();
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) ?? {};
  return respond(async () => ({ request: await updateSupplyRequest(user, id, body, request) }));
}

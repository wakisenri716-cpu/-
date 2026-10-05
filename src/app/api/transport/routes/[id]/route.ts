import { requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { deleteRoute, updateRoute } from "@/lib/transport";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireMember();
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  return respond(() => updateRoute(user, id, body));
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireMember();
  const { id } = await params;
  return respond(async () => {
    await deleteRoute(user, id);
    return { ok: true };
  });
}

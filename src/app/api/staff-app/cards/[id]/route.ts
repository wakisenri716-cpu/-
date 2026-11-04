import { requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { cancelOwnCard } from "@/lib/cardOrders";

// 発注前の自分の申し込みを取り消す
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireMember();
  const { id } = await params;
  return respond(async () => {
    await cancelOwnCard(user, id);
    return { ok: true };
  });
}

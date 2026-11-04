import { requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { claimLost } from "@/lib/lostItems";

// 「わたしのです」と名のる
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireMember();
  const { id } = await params;
  return respond(async () => ({ item: await claimLost(user, id) }));
}

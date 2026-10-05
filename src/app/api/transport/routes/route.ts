import { requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { addRoute } from "@/lib/transport";

export async function POST(request: Request) {
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(() => addRoute(user, body), 201);
}

import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { updateEvent } from "@/lib/companyEvents";

// { action: "paid", userId, paid } 会費の受け取り、{ action: "close", closed } 出欠の締め、{ action: "remind" } 答えていない人に催促
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireCompanyId();
  const user = await requireMember();
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) ?? {};
  return respond(() => updateEvent(user, id, body, request));
}

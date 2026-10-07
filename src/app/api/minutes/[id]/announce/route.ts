import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { postMinutesAsAnnouncement } from "@/lib/minutes";

// 議事録を社内のお知らせに載せる。{ notify }(メールでも知らせる)
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireCompanyId();
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(() => postMinutesAsAnnouncement(user, id, body, request));
}

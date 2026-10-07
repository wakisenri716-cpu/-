import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { listMinutes, saveMinutes } from "@/lib/minutes";

// 議事録の一覧
export async function GET() {
  const companyId = await requireCompanyId();
  return respond(() => listMinutes(companyId));
}

// 議事録を保存する。{ title, heldOn, place, attendees, content, notes, mode }
export async function POST(request: Request) {
  await requireCompanyId();
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(() => saveMinutes(user, body), 201);
}

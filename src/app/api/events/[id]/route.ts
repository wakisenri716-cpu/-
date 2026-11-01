import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { updateEvent } from "@/lib/companyEvents";
import { audit } from "@/lib/audit";

// { action: "paid", userId, paid } 会費の受け取り、{ action: "close", closed } 出欠の締め、{ action: "remind" } 答えていない人に催促、
// { action: "cost", cost } かかった金額、{ action: "post", payFrom: "1010" | "1020" } 会社の負担分を福利厚生費で仕訳
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireCompanyId();
  const user = await requireMember();
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) ?? {};
  return respond(async () => {
    const r = await updateEvent(user, id, body, request);
    if (body.action === "post" && "share" in r && r.share) await audit("社内イベントの会社負担を仕訳", `福利厚生費 ${r.share.toLocaleString()}円`);
    return r;
  });
}

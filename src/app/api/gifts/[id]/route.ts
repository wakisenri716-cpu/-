import { requireCompanyId } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { updateGift } from "@/lib/gifts";

// { action: "thanked", thanked } お礼をした・まだに戻す、{ action: "delete" } 消す
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const companyId = await requireCompanyId();
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) ?? {};
  return respond(async () => ({ gift: await updateGift(companyId, id, body) }));
}

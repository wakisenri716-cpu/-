import { NextResponse } from "next/server";
import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { draftPriceLetter, getPriceReview } from "@/lib/priceReview";

// 値上げの検討。GET は数字だけ、POST はお知らせ文(AIが使えるときは見立てつき)。何も保存しない
export async function GET() {
  const companyId = await requireCompanyId();
  return NextResponse.json(await getPriceReview(companyId));
}

export async function POST(request: Request) {
  await requireCompanyId();
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(() => draftPriceLetter(user, body));
}

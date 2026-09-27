import { NextResponse } from "next/server";
import { requireMember } from "@/lib/auth/session";
import { myOpenAdvances } from "@/lib/accounting/cashAdvances";

// 自分が受け取って、まだ精算していない仮払金(従業員も見られる)
export async function GET() {
  const user = await requireMember();
  return NextResponse.json(await myOpenAdvances(user.companyId, user.id));
}

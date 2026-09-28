import { NextResponse } from "next/server";
import { requireMember } from "@/lib/auth/session";
import { myLoans } from "@/lib/equipment";

// 自分が借りている備品(従業員も見られる)
export async function GET() {
  const user = await requireMember();
  return NextResponse.json(await myLoans(user.companyId, user.id));
}

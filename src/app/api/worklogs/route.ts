import { NextResponse } from "next/server";
import { requireMember } from "@/lib/auth/session";
import { createWorkLog, myWorkLogs } from "@/lib/workLogs";
import { UserError } from "@/lib/errors";

// 自分の日報(従業員も使える)
export async function GET(request: Request) {
  const user = await requireMember();
  const month = new URL(request.url).searchParams.get("month");
  // 管理者・経理担当には、会社全体の集計への入口を出す
  return NextResponse.json({ ...(await myWorkLogs(user.companyId, user.id, month)), canManage: user.role !== "EMPLOYEE" });
}

export async function POST(request: Request) {
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  try {
    return NextResponse.json(await createWorkLog(user.companyId, user.id, body), { status: 201 });
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}

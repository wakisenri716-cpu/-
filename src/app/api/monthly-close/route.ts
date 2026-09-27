import { NextResponse } from "next/server";
import { requireCompanyId, requireUser } from "@/lib/auth/session";
import { getMonthlyClose, setManualCheck } from "@/lib/monthlyClose";
import { audit } from "@/lib/audit";
import { UserError } from "@/lib/errors";

export async function GET(request: Request) {
  const companyId = await requireCompanyId();
  try {
    return NextResponse.json(await getMonthlyClose(companyId, new URL(request.url).searchParams.get("month")));
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}

// 人が確かめる項目のチェックを付ける・外す
export async function PUT(request: Request) {
  const companyId = await requireCompanyId();
  const user = await requireUser();
  const body = await request.json().catch(() => ({}));
  try {
    const { month } = await setManualCheck(companyId, body, user.name);
    await audit(body.done ? "月次決算のチェックを付けた" : "月次決算のチェックを外した", `${month} ${String(body.key ?? "").replace(/^custom:/, "")}`);
    return NextResponse.json(await getMonthlyClose(companyId, month));
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}

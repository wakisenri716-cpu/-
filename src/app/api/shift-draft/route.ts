import { NextResponse } from "next/server";
import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { buildShiftDraft, createShiftsFromDraft, reviewShiftDraft } from "@/lib/shiftDraft";
import { audit } from "@/lib/audit";
import { notifyShiftsBulk } from "@/lib/push/events";

// シフトの自動作成。GET は直近4週から出した必要な人数で下書きを作る(保存しない)
export async function GET(request: Request) {
  const companyId = await requireCompanyId();
  return respond(() => buildShiftDraft(companyId, { month: new URL(request.url).searchParams.get("month") }));
}

// { action: "draft", month, needs, includeUnsubmitted } 下書き / { action: "review", ... } AIの見立てつき / { action: "create", month, items } シフトを作る
export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  const input = { month: body.month, needs: body.needs, includeUnsubmitted: body.includeUnsubmitted };
  if (body.action === "draft") return respond(() => buildShiftDraft(companyId, input));
  if (body.action === "review") return respond(() => reviewShiftDraft(user, input));
  if (body.action === "create") {
    return respond(async () => {
      const { shifts, ...r } = await createShiftsFromDraft(companyId, { month: body.month, items: body.items });
      await audit("シフトの自動作成からシフトを作成", `${r.month} ${r.created}件`);
      notifyShiftsBulk(companyId, shifts);
      return r;
    });
  }
  return NextResponse.json({ error: "操作が正しくありません" }, { status: 400 });
}

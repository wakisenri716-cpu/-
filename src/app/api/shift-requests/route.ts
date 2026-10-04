import { requireCompanyId } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { applyRequests, getRequestBoard, setDeadline } from "@/lib/shiftRequests";
import { audit } from "@/lib/audit";
import { NextResponse } from "next/server";
import { notifyShiftsBulk } from "@/lib/push/events";

export async function GET(request: Request) {
  const companyId = await requireCompanyId();
  return respond(() => getRequestBoard(companyId, new URL(request.url).searchParams.get("month")));
}

// { action: "apply", month, staffId? } 希望からシフトを作る / { action: "deadline", day } 提出の締め切り
export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  if (body.action === "apply") {
    return respond(async () => {
      const { shifts, ...r } = await applyRequests(companyId, body.month, body.staffId ? String(body.staffId) : undefined);
      await audit("シフト希望からシフトを作成", `${r.month} ${r.created}件`);
      notifyShiftsBulk(companyId, shifts);
      return r;
    });
  }
  if (body.action === "deadline") {
    return respond(async () => {
      const day = await setDeadline(companyId, body.day);
      await audit("シフト希望の締め切りを変更", day ? `前月${day}日` : "なし");
      return { day };
    });
  }
  return NextResponse.json({ error: "操作が正しくありません" }, { status: 400 });
}

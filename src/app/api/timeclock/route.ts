import { requireCompanyId } from "@/lib/auth/session";
import { AttendanceError, getBoard, punch, type PunchAction } from "@/lib/attendance/service";
import { respond } from "@/lib/shifts/http";

const ACTIONS: PunchAction[] = ["in", "breakStart", "breakEnd", "out"];

export async function GET() {
  const companyId = await requireCompanyId();
  return respond(() => getBoard(companyId));
}

export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  const action = ACTIONS.find((a) => a === body.action);
  return respond(async () => {
    if (!action) throw new AttendanceError("action が正しくありません");
    await punch(companyId, String(body.staffId ?? ""), action);
    return getBoard(companyId);
  });
}

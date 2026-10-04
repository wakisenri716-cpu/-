import { requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { myShiftMonth, saveMyShiftMonth } from "@/lib/shiftRequests";
import { audit } from "@/lib/audit";

// 自分のシフト希望と決まったシフト(?month=YYYY-MM)
export async function GET(request: Request) {
  const user = await requireMember();
  return respond(() => myShiftMonth(user.companyId, user.id, new URL(request.url).searchParams.get("month")));
}

// 1か月分の希望をまとめて保存: { month, days: [{ date, status: "available" | "off" | "", start, end, note }] }
export async function PUT(request: Request) {
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    const r = await saveMyShiftMonth(user.companyId, user.id, body.month, body.days);
    await audit("シフト希望を提出", `${r.staff.name} ${r.month} ${r.saved}日分`);
    return { month: r.month, saved: r.saved };
  });
}

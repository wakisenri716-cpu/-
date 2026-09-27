import { requireCompanyId } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { getOvertime, updateOvertimeSettings } from "@/lib/leave/overtime";
import { audit } from "@/lib/audit";

export async function GET(request: Request) {
  const companyId = await requireCompanyId();
  const month = new URL(request.url).searchParams.get("month");
  return respond(() => getOvertime(companyId, month));
}

export async function PATCH(request: Request) {
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    const settings = await updateOvertimeSettings(companyId, body);
    await audit("36協定の設定を変更", `起算${settings.startMonth}月・月${settings.monthlyLimit}時間・年${settings.yearlyLimit}時間`);
    return settings;
  });
}

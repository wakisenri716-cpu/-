import { requireCompanyId } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { setIncomeTaxOverride } from "@/lib/payroll/service";
import { audit } from "@/lib/audit";

// 源泉所得税を手で直す(incomeTax: null で自動計算に戻す)
export async function PUT(request: Request) {
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    const value = await setIncomeTaxOverride(companyId, String(body.staffId ?? ""), String(body.month ?? ""), body.incomeTax);
    await audit("源泉所得税を手で修正", `${body.month} ${value === null ? "自動計算に戻す" : `${value}円`}`);
    return { incomeTax: value };
  });
}

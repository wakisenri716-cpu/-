import { NextResponse } from "next/server";
import { adminOr403 } from "@/lib/auth/users";
import { respond } from "@/lib/shifts/http";
import { updatePayrollSettings } from "@/lib/payroll/service";
import { audit } from "@/lib/audit";

// 保険料率の設定(管理者のみ)
export async function PUT(request: Request) {
  const admin = await adminOr403();
  if (admin instanceof NextResponse) return admin;
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    const saved = await updatePayrollSettings(admin.companyId, body);
    const r = saved.rates;
    await audit("保険料率を変更", `${saved.prefecture} 健康${r.health / 1000}% 介護${r.care / 1000}% 厚生年金${r.pension / 1000}% 雇用${r.employment / 1000}%`);
    return saved;
  });
}

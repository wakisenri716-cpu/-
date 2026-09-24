import { requireCompanyId } from "@/lib/auth/session";
import { updateStaff } from "@/lib/shifts/service";
import { respond } from "@/lib/shifts/http";
import { audit } from "@/lib/audit";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    const staff = await updateStaff(companyId, id, {
      ...(body.hourlyWage !== undefined ? { hourlyWage: Number(body.hourlyWage) } : {}),
      ...(typeof body.active === "boolean" ? { active: body.active } : {}),
      ...(body.pin === null || typeof body.pin === "string" ? { pin: body.pin } : {}),
    });
    const changes = [
      body.hourlyWage !== undefined ? `時給を¥${staff.hourlyWage.toLocaleString("ja-JP")}に変更` : null,
      typeof body.active === "boolean" ? (body.active ? "在籍に戻す" : "退職にする") : null,
      body.pin === null ? "暗証番号を解除" : typeof body.pin === "string" ? "暗証番号を設定" : null,
    ].filter(Boolean);
    if (changes.length) await audit("スタッフ変更", `${staff.name}: ${changes.join("・")}`);
    return staff;
  });
}

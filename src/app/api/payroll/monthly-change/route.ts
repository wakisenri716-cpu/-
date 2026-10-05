import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { addWageChange, applyMonthlyChange, deleteWageChange, listMonthlyChanges, undoMonthlyChange } from "@/lib/payroll/monthlyChange";
import { audit } from "@/lib/audit";

// 固定的賃金の変動と月額変更(随時改定)の判定
export async function GET() {
  const companyId = await requireCompanyId();
  return respond(() => listMonthlyChanges(companyId));
}

// { action: "add", staffId, month, kind, before, after } 変動をあとから記録
// { action: "apply" | "undo", id } 新しい標準報酬月額を反映 / 反映を取り消す
export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    if (body.action === "add") {
      const c = await addWageChange(companyId, body);
      await audit("固定的賃金の変動を記録", `${c.staffName} ${c.month} ${c.before.toLocaleString()}→${c.after.toLocaleString()}円`);
      return c;
    }
    if (body.action === "apply") {
      const r = await applyMonthlyChange(companyId, user, String(body.id ?? ""));
      await audit("月額変更(随時改定)を反映", `${r.staffName} ${(r.current ?? 0).toLocaleString()}→${(r.next ?? 0).toLocaleString()}円(${r.effectiveMonth}分から)`);
      return { ok: true };
    }
    if (body.action === "undo") {
      const c = await undoMonthlyChange(companyId, String(body.id ?? ""));
      await audit("月額変更(随時改定)の反映を取消", c.staffName);
      return { ok: true };
    }
    return { ok: false };
  });
}

export async function DELETE(request: Request) {
  const companyId = await requireCompanyId();
  const id = new URL(request.url).searchParams.get("id") ?? "";
  return respond(async () => {
    const c = await deleteWageChange(companyId, id);
    await audit("固定的賃金の変動の記録を削除", `${c.staffName} ${c.month}`);
    return { ok: true };
  });
}

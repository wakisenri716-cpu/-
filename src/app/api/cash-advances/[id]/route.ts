import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { cancelCashAdvance, settleCashAdvance, undoSettlement } from "@/lib/accounting/cashAdvances";
import { audit, yen } from "@/lib/audit";
import { UserError } from "@/lib/errors";

// 精算(settle)・精算の取消(undo)・渡したことの取消(cancel)
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  try {
    if (body.action === "settle") {
      const { advance, reportAmount, diff } = await settleCashAdvance(companyId, id, body);
      const rest = diff > 0 ? `返金 ${yen(diff)}` : diff < 0 ? `追加で支払 ${yen(-diff)}` : "差額なし";
      await audit("仮払金を精算", `${advance.employee.name} ${advance.purpose} 仮払 ${yen(advance.amount)}・経費 ${yen(reportAmount)}・${rest}`);
      return NextResponse.json({ ok: true, diff });
    }
    if (body.action === "undo") {
      const advance = await undoSettlement(companyId, id);
      await audit("仮払金の精算を取消", `${advance.employee.name} ${advance.purpose}`);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "cancel") {
      const advance = await cancelCashAdvance(companyId, id);
      await audit("仮払金を取消", `${advance.employee.name} ${advance.purpose} ${yen(advance.amount)}`);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "操作を指定してください" }, { status: 400 });
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}

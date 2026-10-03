import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { deleteLoan, postPayment, undoLastPayment, updateLoan } from "@/lib/accounting/loans";
import { respond } from "@/lib/shifts/http";
import { audit, yen } from "@/lib/audit";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    const l = await updateLoan(companyId, id, body);
    const onlyActive = typeof body.active === "boolean" && Object.keys(body).length === 1;
    await audit(onlyActive ? (l.active ? "借入金の記帳を再開" : "借入金の記帳を止める") : "借入金を変更", l.name);
    return l;
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  return respond(async () => {
    const l = await deleteLoan(companyId, id);
    await audit("借入金を削除", l.name);
    return { ok: true };
  });
}

// { action: "pay", month, principal?, interest? } 返済を記帳 / { action: "undo" } 最後の返済を取消し
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  if (body.action !== "pay" && body.action !== "undo") return NextResponse.json({ error: "操作が正しくありません" }, { status: 400 });
  return respond(async () => {
    const r = body.action === "pay" ? await postPayment(companyId, id, body) : await undoLastPayment(companyId, id);
    await audit(body.action === "pay" ? "借入金の返済を記帳" : "借入金の返済の記帳を取消し", `${r.loan.name} ${r.month} 元金${yen(r.principal)} 利息${yen(r.interest)}`);
    return { month: r.month, principal: r.principal, interest: r.interest };
  });
}

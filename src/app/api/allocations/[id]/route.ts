import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { deleteAllocation, postMonth, undoLastPosting, updateAllocation } from "@/lib/accounting/allocations";
import { respond } from "@/lib/shifts/http";
import { audit, yen } from "@/lib/audit";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    const a = await updateAllocation(companyId, id, body);
    const onlyActive = typeof body.active === "boolean" && Object.keys(body).length === 1;
    await audit(onlyActive ? (a.active ? "期間按分を再開" : "期間按分を止める") : "期間按分を変更", a.name);
    return a;
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  return respond(async () => {
    const a = await deleteAllocation(companyId, id);
    await audit("期間按分を削除", a.name);
    return { ok: true };
  });
}

// { action: "post", month } 1か月分を計上 / { action: "undo" } 最後の計上を取り消す
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  if (body.action !== "post" && body.action !== "undo") return NextResponse.json({ error: "操作が正しくありません" }, { status: 400 });
  return respond(async () => {
    const r = body.action === "post" ? await postMonth(companyId, id, String(body.month ?? "")) : await undoLastPosting(companyId, id);
    await audit(body.action === "post" ? "期間按分を計上" : "期間按分の計上を取消し", `${r.allocation.name} ${r.month} ${yen(r.amount)}`);
    return { month: r.month, amount: r.amount };
  });
}

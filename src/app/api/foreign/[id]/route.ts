import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { deleteForeignTransaction, settleForeignTransaction, unsettleForeignTransaction } from "@/lib/accounting/foreign";
import { audit } from "@/lib/audit";

type Params = { params: Promise<{ id: string }> };

// { action: "settle", date, jpy | rate, cashCode } 入金・支払い / { action: "unsettle" } その取り消し
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  if (body.action === "settle") {
    return respond(async () => {
      const r = await settleForeignTransaction(companyId, id, body);
      await audit("外貨建て取引の入金・支払い", `${r.jpy.toLocaleString()}円(為替差${r.gain >= 0 ? "益" : "損"} ${Math.abs(r.gain).toLocaleString()}円)`);
      return r;
    });
  }
  if (body.action === "unsettle") {
    return respond(async () => {
      await unsettleForeignTransaction(companyId, id);
      await audit("外貨建て取引の入金・支払いを取消");
      return { ok: true };
    });
  }
  return NextResponse.json({ error: "操作が正しくありません" }, { status: 400 });
}

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  return respond(async () => {
    const t = await deleteForeignTransaction(companyId, id);
    await audit("外貨建て取引を取消", t.partner);
    return { ok: true };
  });
}

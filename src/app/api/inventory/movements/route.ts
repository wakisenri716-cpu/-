import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { recordStockMovement } from "@/lib/accounting/inventory";
import { UserError } from "@/lib/errors";

const TYPES = ["PURCHASE", "ISSUE", "STOCKTAKE"] as const;

export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));

  const type = TYPES.find((t) => t === body.type);
  if (!type) {
    return NextResponse.json({ error: "区分を選択してください" }, { status: 400 });
  }
  const date = body.date ? new Date(body.date) : new Date();
  if (Number.isNaN(date.getTime())) {
    return NextResponse.json({ error: "日付を正しく入力してください" }, { status: 400 });
  }

  try {
    const result = await recordStockMovement(companyId, {
      productId: String(body.productId ?? ""),
      type,
      date,
      quantity: Number(body.quantity),
      unitCost: body.unitCost === undefined || body.unitCost === "" ? undefined : Number(body.unitCost),
      paymentAccountCode: body.paymentAccountCode ? String(body.paymentAccountCode) : undefined,
      taxable: body.taxable === true,
      memo: body.memo ? String(body.memo) : null,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof UserError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}

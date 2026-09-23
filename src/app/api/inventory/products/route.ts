import { NextResponse } from "next/server";
import { getDefaultCompanyId } from "@/lib/demo";
import { createProduct, InventoryError } from "@/lib/accounting/inventory";

export async function POST(request: Request) {
  const companyId = await getDefaultCompanyId();
  const body = await request.json().catch(() => ({}));
  const name = String(body.name ?? "").trim();
  const unit = String(body.unit ?? "").trim() || "個";
  const code = String(body.code ?? "").trim() || null;

  if (!name) {
    return NextResponse.json({ error: "商品名を入力してください" }, { status: 400 });
  }

  try {
    return NextResponse.json(await createProduct(companyId, { name, unit, code }), { status: 201 });
  } catch (error) {
    if (error instanceof InventoryError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}

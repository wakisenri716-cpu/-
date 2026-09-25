import { NextResponse } from "next/server";
import { adminOr403 } from "@/lib/auth/users";
import { BUSINESS_TYPES, TAX_METHODS, updateTaxMethod } from "@/lib/accounting/consumptionTax";
import { audit } from "@/lib/audit";
import { UserError } from "@/lib/errors";

export async function PUT(request: Request) {
  const admin = await adminOr403();
  if (admin instanceof NextResponse) return admin;
  const body = await request.json().catch(() => ({}));
  try {
    const saved = await updateTaxMethod(admin.companyId, body);
    const method = TAX_METHODS[saved.consumptionTaxMethod as keyof typeof TAX_METHODS];
    await audit("消費税の計算方式を変更", saved.consumptionTaxMethod === "SIMPLIFIED" ? `${method}(${BUSINESS_TYPES[saved.simplifiedBusinessType].label})` : method);
    return NextResponse.json(saved);
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}

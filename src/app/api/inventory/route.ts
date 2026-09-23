import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { getInventory } from "@/lib/accounting/inventory";

export async function GET() {
  const companyId = await requireCompanyId();
  return NextResponse.json(await getInventory(companyId));
}

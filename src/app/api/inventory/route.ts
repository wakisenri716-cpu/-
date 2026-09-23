import { NextResponse } from "next/server";
import { getDefaultCompanyId } from "@/lib/demo";
import { getInventory } from "@/lib/accounting/inventory";

export async function GET() {
  const companyId = await getDefaultCompanyId();
  return NextResponse.json(await getInventory(companyId));
}

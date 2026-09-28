import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { createEquipment, listEquipment } from "@/lib/equipment";
import { audit } from "@/lib/audit";
import { UserError } from "@/lib/errors";

export async function GET() {
  const companyId = await requireCompanyId();
  return NextResponse.json(await listEquipment(companyId));
}

export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  try {
    const item = await createEquipment(companyId, body);
    await audit("備品を登録", `${item.code ? `${item.code} ` : ""}${item.name}`);
    return NextResponse.json(item, { status: 201 });
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}

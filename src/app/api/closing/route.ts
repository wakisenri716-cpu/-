import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { adminOr403 } from "@/lib/auth/users";
import { getClosing, setBooksClosed } from "@/lib/accounting/closing";
import { UserError } from "@/lib/errors";
import { audit } from "@/lib/audit";

export async function GET() {
  const companyId = await requireCompanyId();
  return NextResponse.json(await getClosing(companyId));
}

// 締め・締めの解除は管理者だけ
export async function PUT(request: Request) {
  const admin = await adminOr403();
  if (admin instanceof NextResponse) return admin;
  const body = await request.json().catch(() => ({}));
  const date = body.date === null ? null : String(body.date ?? "");
  try {
    const closed = await setBooksClosed(admin.companyId, date);
    await audit(closed ? "帳簿を締める" : "帳簿の締めを解除", closed ? `${closed}まで` : null);
    return NextResponse.json(await getClosing(admin.companyId));
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}

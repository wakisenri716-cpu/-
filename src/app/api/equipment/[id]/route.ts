import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { deleteEquipment, lend, returnLoan, updateEquipment } from "@/lib/equipment";
import { audit } from "@/lib/audit";
import { UserError } from "@/lib/errors";

type Params = { params: Promise<{ id: string }> };
const label = (e: { code: string | null; name: string }) => `${e.code ? `${e.code} ` : ""}${e.name}`;

function fail(error: unknown) {
  if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
  throw error;
}

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  try {
    const item = await updateEquipment(companyId, id, body);
    await audit("備品を変更", label(item));
    return NextResponse.json(item);
  } catch (error) {
    return fail(error);
  }
}

// 貸出・返却: { action: "lend", userId | borrowerName, lentAt, dueDate, notes } / { action: "return", returnedAt }
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  try {
    if (body.action === "lend") {
      const loan = await lend(companyId, id, body);
      await audit("備品を貸出", `${label(loan.equipment)} → ${loan.borrowerName}`);
      return NextResponse.json(loan, { status: 201 });
    }
    if (body.action === "return") {
      const loan = await returnLoan(companyId, id, body);
      await audit("備品の返却を記録", `${label(loan.equipment)} ← ${loan.borrowerName}`);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "操作が正しくありません" }, { status: 400 });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  try {
    const item = await deleteEquipment(companyId, id);
    await audit("備品を削除", label(item));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}

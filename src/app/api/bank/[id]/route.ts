import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { confirmBankTransaction, ignoreBankTransaction, reopenBankTransaction } from "@/lib/bank/process";
import { UserError } from "@/lib/errors";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));

  try {
    if (body.action === "confirm") {
      return NextResponse.json(await confirmBankTransaction(companyId, id, String(body.accountId ?? "")));
    }
    if (body.action === "ignore") return NextResponse.json(await ignoreBankTransaction(companyId, id));
    if (body.action === "reopen") return NextResponse.json(await reopenBankTransaction(companyId, id));
    return NextResponse.json({ error: "action が正しくありません" }, { status: 400 });
  } catch (error) {
    if (error instanceof UserError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}

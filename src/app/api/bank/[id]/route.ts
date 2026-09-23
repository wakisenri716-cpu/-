import { NextResponse } from "next/server";
import { getDefaultCompanyId } from "@/lib/demo";
import { BankError, confirmBankTransaction, ignoreBankTransaction, reopenBankTransaction } from "@/lib/bank/process";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const companyId = await getDefaultCompanyId();
  const body = await request.json().catch(() => ({}));

  try {
    if (body.action === "confirm") {
      return NextResponse.json(await confirmBankTransaction(companyId, id, String(body.accountId ?? "")));
    }
    if (body.action === "ignore") return NextResponse.json(await ignoreBankTransaction(companyId, id));
    if (body.action === "reopen") return NextResponse.json(await reopenBankTransaction(companyId, id));
    return NextResponse.json({ error: "action が正しくありません" }, { status: 400 });
  } catch (error) {
    if (error instanceof BankError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}

import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { decodeCsv } from "@/lib/csvParse";
import { parseBankStatement, parseCardStatement } from "@/lib/bank/statement";
import { importBankStatement } from "@/lib/bank/process";
import { getBankAccount } from "@/lib/bank/accounts";
import { UserError } from "@/lib/errors";

export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "CSVファイルを選択してください" }, { status: 400 });
  }
  const accountId = formData.get("bankAccountId");

  try {
    // 口座ならば銀行明細、カードならばカードの利用明細として読む
    const bank = await getBankAccount(companyId, typeof accountId === "string" && accountId ? accountId : null);
    let rows;
    try {
      const text = decodeCsv(await file.arrayBuffer());
      rows = bank.kind === "CARD" ? parseCardStatement(text) : parseBankStatement(text);
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "CSVを読み取れません" }, { status: 400 });
    }
    if (rows.length === 0) {
      return NextResponse.json({ error: "CSVに取り込める明細がありません" }, { status: 400 });
    }
    return NextResponse.json(await importBankStatement(companyId, rows, bank.id));
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}

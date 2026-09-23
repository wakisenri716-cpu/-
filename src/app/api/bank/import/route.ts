import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { decodeCsv } from "@/lib/csvParse";
import { parseBankStatement } from "@/lib/bank/statement";
import { importBankStatement } from "@/lib/bank/process";

export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "CSVファイルを選択してください" }, { status: 400 });
  }

  let rows;
  try {
    rows = parseBankStatement(decodeCsv(await file.arrayBuffer()));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "CSVを読み取れません" }, { status: 400 });
  }
  if (rows.length === 0) {
    return NextResponse.json({ error: "CSVに取り込める明細がありません" }, { status: 400 });
  }

  return NextResponse.json(await importBankStatement(companyId, rows));
}

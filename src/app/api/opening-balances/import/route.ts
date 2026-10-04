import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { decodeCsv } from "@/lib/csvParse";
import { readBalanceCsv } from "@/lib/accounting/openingBalances";

// ほかの会計ソフトの残高試算表・貸借対照表の CSV を読んで、入力欄に入れる金額を返す(まだ保存しない)
export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const file = (await request.formData()).get("file");
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "CSVファイルを選んでください" }, { status: 400 });
  if (file.size > 2_000_000) return NextResponse.json({ error: "ファイルが大きすぎます(2MBまで)" }, { status: 400 });
  return respond(async () => readBalanceCsv(companyId, decodeCsv(await file.arrayBuffer())));
}

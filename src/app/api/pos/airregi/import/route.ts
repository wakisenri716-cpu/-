import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { importPosSales } from "@/lib/pos/importSales";
import { parseAirregiCsv } from "@/lib/pos/airregi";
import { decodeCsv } from "@/lib/csvParse";

export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "CSVファイルを選択してください" }, { status: 400 });
  }

  let parsed;
  try {
    parsed = parseAirregiCsv(decodeCsv(await file.arrayBuffer()));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "CSVを読み取れません" }, { status: 400 });
  }
  if (parsed.sales.length === 0) {
    return NextResponse.json({ error: "CSVに取り込める会計がありません" }, { status: 400 });
  }

  const result = await importPosSales(companyId, "AIRREGI", parsed.sales);
  return NextResponse.json({ ...result, rowCount: parsed.rowCount });
}

import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { decodeCsv } from "@/lib/csvParse";
import { csvResponse } from "@/lib/csv";
import { importProducts, PRODUCT_SAMPLE } from "@/lib/masterImport";
import { UserError } from "@/lib/errors";
import { audit } from "@/lib/audit";

export async function GET() {
  await requireCompanyId();
  return csvResponse("商品_登録サンプル.csv", PRODUCT_SAMPLE);
}

export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const file = (await request.formData()).get("file");
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "CSVファイルを選択してください" }, { status: 400 });
  if (file.size > 2 * 1024 * 1024) return NextResponse.json({ error: "ファイルが大きすぎます(2MBまで)" }, { status: 400 });
  try {
    const result = await importProducts(companyId, decodeCsv(await file.arrayBuffer()));
    await audit("商品をCSV登録", `追加${result.created}件・更新${result.updated}件`);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}

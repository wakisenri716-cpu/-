import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { decodeCsv } from "@/lib/csvParse";
import { csvResponse } from "@/lib/csv";
import { importInvoices, INVOICE_SAMPLE, previewInvoiceImport } from "@/lib/accounting/invoiceImport";
import { UserError } from "@/lib/errors";
import { audit } from "@/lib/audit";

export async function GET() {
  await requireCompanyId();
  return csvResponse("請求書_一括作成サンプル.csv", INVOICE_SAMPLE);
}

// file: CSV、mode: "preview"(確認だけ) / "import"(作成)
export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "CSVファイルを選択してください" }, { status: 400 });
  if (file.size > 2 * 1024 * 1024) return NextResponse.json({ error: "ファイルが大きすぎます(2MBまで)" }, { status: 400 });
  const text = decodeCsv(await file.arrayBuffer());
  try {
    if (form.get("mode") !== "import") return NextResponse.json(await previewInvoiceImport(companyId, text));
    const result = await importInvoices(companyId, text);
    await audit("請求書をCSVで一括作成", `${result.created.length}枚 ${result.total.toLocaleString()}円`);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}

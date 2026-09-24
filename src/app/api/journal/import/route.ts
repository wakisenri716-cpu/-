import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { decodeCsv } from "@/lib/csvParse";
import { ImportError, importJournalCsv, parseJournalCsv } from "@/lib/accounting/journalImport";
import { audit } from "@/lib/audit";

// preview=1 なら取り込まずに読み取り結果だけ返す
export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const preview = new URL(request.url).searchParams.get("preview") === "1";
  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "CSVファイルを選択してください" }, { status: 400 });
  }
  if (file.size > 5 * 1024 * 1024) return NextResponse.json({ error: "ファイルが大きすぎます(5MBまで)" }, { status: 400 });
  const text = decodeCsv(await file.arrayBuffer());
  try {
    if (preview) return NextResponse.json(await parseJournalCsv(companyId, text));
    const result = await importJournalCsv(companyId, text);
    await audit("仕訳をCSV取込", `${file.name}: ${result.imported}件(重複${result.skipped}件は除外)`);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ImportError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}

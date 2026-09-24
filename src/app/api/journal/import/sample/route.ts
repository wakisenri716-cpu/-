import { requireCompanyId } from "@/lib/auth/session";
import { csvResponse } from "@/lib/csv";
import { SAMPLE_CSV } from "@/lib/accounting/journalImport";

export async function GET() {
  await requireCompanyId();
  return csvResponse("仕訳取込サンプル.csv", SAMPLE_CSV);
}

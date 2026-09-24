import { requireCompanyId } from "@/lib/auth/session";
import { KIND_LABELS, searchDocuments } from "@/lib/documents";
import { csvResponse } from "@/lib/csv";

export async function GET(request: Request) {
  const companyId = await requireCompanyId();
  const q = Object.fromEntries(new URL(request.url).searchParams);
  const { rows } = await searchDocuments(companyId, q);
  const csv: (string | number)[][] = [["取引日", "種類", "取引先", "金額", "内容", "画像"]];
  for (const r of rows) csv.push([r.date ?? "", KIND_LABELS[r.kind], r.party ?? "", r.amount, r.description, r.hasFile ? "あり" : "なし"]);
  return csvResponse("証憑検索結果.csv", csv);
}

import { requireCompanyId } from "@/lib/auth/session";
import { BUCKETS, getAging } from "@/lib/accounting/receivables";
import { csvResponse } from "@/lib/csv";

export async function GET(request: Request) {
  const companyId = await requireCompanyId();
  const direction = new URL(request.url).searchParams.get("type") === "payable" ? "RECEIVED" : "ISSUED";
  const aging = await getAging(companyId, direction);
  const label = direction === "ISSUED" ? "売掛金" : "買掛金";
  const rows: (string | number)[][] = [["取引先", "請求書番号", "請求日", "期日", "請求額", "残高", "超過日数", "区分"]];
  for (const r of aging.rows) {
    rows.push([r.partyName, r.invoiceNumber ?? "", r.issueDate ?? "", r.dueDate ?? "", r.total, r.remaining, r.overdueDays, BUCKETS.find((b) => b.key === r.bucket)!.label]);
  }
  rows.push(["合計", "", "", "", "", aging.total, "", ""]);
  return csvResponse(`${label}残高_${aging.today}.csv`, rows);
}

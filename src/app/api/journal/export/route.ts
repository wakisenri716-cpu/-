import { requireCompanyId } from "@/lib/auth/session";
import { getJournalBook, journalFilterFromParams, SOURCE_LABELS } from "@/lib/accounting/journal";
import { csvResponse } from "@/lib/csv";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function GET(request: Request) {
  const companyId = await requireCompanyId();
  const params = new URL(request.url).searchParams;
  const param = params.get("month");
  const month = param && MONTH.test(param) ? param : undefined;
  const entries = await getJournalBook(companyId, { month, postedOnly: true, filter: journalFilterFromParams(params) });

  const rows: (string | number)[][] = [["日付", "伝票", "摘要", "区分", "科目コード", "勘定科目", "借方金額", "貸方金額", "メモ"]];
  entries
    .slice()
    .reverse()
    .forEach((entry, i) => {
      for (const line of entry.lines) {
        rows.push([
          entry.date.toISOString().slice(0, 10),
          i + 1,
          entry.description,
          SOURCE_LABELS[entry.sourceType],
          line.account.code,
          line.account.name,
          line.debit || "",
          line.credit || "",
          line.memo ?? "",
        ]);
      }
    });
  return csvResponse(month ? `仕訳帳_${month}.csv` : "仕訳帳.csv", rows);
}

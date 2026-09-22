import Link from "next/link";
import { getIncomeStatement } from "@/lib/accounting/incomeStatement";
import { getDefaultCompanyId } from "@/lib/demo";
import { formatYen } from "@/lib/format";
import { CsvDownloadLink } from "@/components/CsvDownloadLink";

export const dynamic = "force-dynamic";

export default async function IncomeStatementPage() {
  const companyId = await getDefaultCompanyId();
  const { revenueRows, expenseRows, totalRevenue, totalExpense, netIncome } = await getIncomeStatement(companyId);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">損益計算書</h1>
          <p className="mt-1 text-sm text-slate-600">
            記帳済みの仕訳から収益・費用を集計し、当期純利益を計算します。確定申告の損益計算の土台として使えます。
          </p>
        </div>
        <CsvDownloadLink href="/api/income-statement/export" />
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2">科目</th>
                <th className="px-4 py-2 text-right">金額</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              <tr className="bg-slate-50/60">
                <td colSpan={2} className="px-4 py-1 text-xs font-semibold text-slate-500">
                  収益
                </td>
              </tr>
              {revenueRows.map((row) => (
                <tr key={row.account.id}>
                  <td className="px-4 py-2">
                    <Link href={`/ledger?accountId=${row.account.id}`} className="hover:underline">
                      {row.account.code} {row.account.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">{formatYen(row.balance)}</td>
                </tr>
              ))}
              {revenueRows.length === 0 && (
                <tr>
                  <td colSpan={2} className="px-4 py-3 text-center text-slate-400">
                    まだ収益がありません。
                  </td>
                </tr>
              )}
              <tr className="border-t font-medium">
                <td className="px-4 py-2">収益合計</td>
                <td className="px-4 py-2 text-right whitespace-nowrap">{formatYen(totalRevenue)}</td>
              </tr>

              <tr className="bg-slate-50/60">
                <td colSpan={2} className="px-4 py-1 text-xs font-semibold text-slate-500">
                  費用
                </td>
              </tr>
              {expenseRows.map((row) => (
                <tr key={row.account.id}>
                  <td className="px-4 py-2">
                    <Link href={`/ledger?accountId=${row.account.id}`} className="hover:underline">
                      {row.account.code} {row.account.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">{formatYen(row.balance)}</td>
                </tr>
              ))}
              {expenseRows.length === 0 && (
                <tr>
                  <td colSpan={2} className="px-4 py-3 text-center text-slate-400">
                    まだ費用がありません。
                  </td>
                </tr>
              )}
              <tr className="border-t font-medium">
                <td className="px-4 py-2">費用合計</td>
                <td className="px-4 py-2 text-right whitespace-nowrap">{formatYen(totalExpense)}</td>
              </tr>
            </tbody>
            <tfoot className="border-t-2 bg-slate-50 font-semibold">
              <tr>
                <td className="px-4 py-3">当期純利益</td>
                <td className={`px-4 py-3 text-right whitespace-nowrap ${netIncome < 0 ? "text-rose-700" : ""}`}>
                  {formatYen(netIncome)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <p className="text-xs text-slate-400">
        総勘定元帳・試算表と同様、`AUTO_POSTED`・`POSTED_MANUALLY` の仕訳のみを集計します(レビュー待ち・却下は含みません)。
      </p>
    </div>
  );
}

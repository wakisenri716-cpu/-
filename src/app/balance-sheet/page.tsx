import Link from "next/link";
import { getBalanceSheet } from "@/lib/accounting/balanceSheet";
import { requireCompanyId } from "@/lib/auth/session";
import { formatYen } from "@/lib/format";
import { CsvDownloadLink } from "@/components/CsvDownloadLink";
import { AsOfPicker } from "@/components/PeriodPicker";
import { resolveAsOf, type PeriodParams } from "@/lib/accounting/period";

export const dynamic = "force-dynamic";

export default async function BalanceSheetPage({ searchParams }: { searchParams: Promise<PeriodParams> }) {
  const companyId = await requireCompanyId();
  const { asOf, label } = resolveAsOf(await searchParams);
  const {
    assetRows,
    liabilityRows,
    equityRows,
    netIncome,
    totalAssets,
    totalLiabilities,
    totalEquity,
    balanced,
  } = await getBalanceSheet(companyId, asOf);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">貸借対照表</h1>
          <p className="mt-1 text-sm text-slate-600">
            資産・負債・純資産の残高を集計します。期中決算のため、純資産には当期純利益(損益計算書と連動)を含めて表示しています。
          </p>
          <p className="mt-1 text-sm font-medium text-slate-800">{label}</p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full whitespace-nowrap px-3 py-1 text-xs font-medium ${
              balanced ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"
            }`}
          >
            {balanced ? "資産 = 負債+純資産" : "資産 ≠ 負債+純資産"}
          </span>
          <CsvDownloadLink href={`/api/balance-sheet/export?asOf=${asOf}`} />
        </div>
      </div>

      <AsOfPicker path="/balance-sheet" asOf={asOf} />

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
                  資産の部
                </td>
              </tr>
              {assetRows.map((row) => (
                <tr key={row.account.id}>
                  <td className="px-4 py-2">
                    <Link href={`/ledger?accountId=${row.account.id}`} className="hover:underline">
                      {row.account.code} {row.account.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">{formatYen(row.balance)}</td>
                </tr>
              ))}
              {assetRows.length === 0 && (
                <tr>
                  <td colSpan={2} className="px-4 py-3 text-center text-slate-400">
                    まだ資産がありません。
                  </td>
                </tr>
              )}
              <tr className="border-t font-medium">
                <td className="px-4 py-2">資産合計</td>
                <td className="px-4 py-2 text-right whitespace-nowrap">{formatYen(totalAssets)}</td>
              </tr>

              <tr className="bg-slate-50/60">
                <td colSpan={2} className="px-4 py-1 text-xs font-semibold text-slate-500">
                  負債の部
                </td>
              </tr>
              {liabilityRows.map((row) => (
                <tr key={row.account.id}>
                  <td className="px-4 py-2">
                    <Link href={`/ledger?accountId=${row.account.id}`} className="hover:underline">
                      {row.account.code} {row.account.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">{formatYen(row.balance)}</td>
                </tr>
              ))}
              {liabilityRows.length === 0 && (
                <tr>
                  <td colSpan={2} className="px-4 py-3 text-center text-slate-400">
                    まだ負債がありません。
                  </td>
                </tr>
              )}
              <tr className="border-t font-medium">
                <td className="px-4 py-2">負債合計</td>
                <td className="px-4 py-2 text-right whitespace-nowrap">{formatYen(totalLiabilities)}</td>
              </tr>

              <tr className="bg-slate-50/60">
                <td colSpan={2} className="px-4 py-1 text-xs font-semibold text-slate-500">
                  純資産の部
                </td>
              </tr>
              {equityRows.map((row) => (
                <tr key={row.account.id}>
                  <td className="px-4 py-2">
                    <Link href={`/ledger?accountId=${row.account.id}`} className="hover:underline">
                      {row.account.code} {row.account.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">{formatYen(row.balance)}</td>
                </tr>
              ))}
              <tr>
                <td className="px-4 py-2">
                  当期純利益{" "}
                  <Link href="/income-statement" className="text-xs text-slate-400 hover:underline">
                    (損益計算書)
                  </Link>
                </td>
                <td className="px-4 py-2 text-right whitespace-nowrap">{formatYen(netIncome)}</td>
              </tr>
              <tr className="border-t font-medium">
                <td className="px-4 py-2">純資産合計</td>
                <td className="px-4 py-2 text-right whitespace-nowrap">{formatYen(totalEquity)}</td>
              </tr>
            </tbody>
            <tfoot className="border-t-2 bg-slate-50 font-semibold">
              <tr>
                <td className="px-4 py-3">負債・純資産合計</td>
                <td className="px-4 py-3 text-right whitespace-nowrap">{formatYen(totalLiabilities + totalEquity)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <p className="text-xs text-slate-400">
        「減価償却累計額」は本来資産の控除項目(contra-asset)ですが、このアプリの残高計算は科目区分から
        貸借を決めるだけの仕組みのため、暫定的に負債の部に表示されています。
      </p>
    </div>
  );
}

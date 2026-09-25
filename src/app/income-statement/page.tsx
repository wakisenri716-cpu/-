import Link from "next/link";
import { getIncomeStatement, getIncomeStatementComparison, type ComparisonRow } from "@/lib/accounting/incomeStatement";
import { requireCompanyId } from "@/lib/auth/session";
import { formatYen } from "@/lib/format";
import { CsvDownloadLink } from "@/components/CsvDownloadLink";
import { PeriodPicker } from "@/components/PeriodPicker";
import { getFiscalStartMonth, periodQuery, resolvePeriod, toRange, type PeriodParams } from "@/lib/accounting/period";

export const dynamic = "force-dynamic";

function display(k: string) {
  const [y, m, d] = k.split("-").map(Number);
  return `${y}/${m}/${d}`;
}

// 増減率。前年が0なら出さない。費用は増えたら赤、収益・利益は減ったら赤。
function Change({ current, prior, kind }: { current: number; prior: number; kind: "revenue" | "expense" }) {
  const diff = current - prior;
  const bad = kind === "expense" ? diff > 0 : diff < 0;
  const pct = prior !== 0 ? `${diff >= 0 ? "+" : ""}${Math.round((diff / Math.abs(prior)) * 1000) / 10}%` : "-";
  return (
    <>
      <td className={`px-4 py-2 text-right tabular-nums whitespace-nowrap ${diff === 0 ? "text-slate-400" : bad ? "text-rose-700" : "text-emerald-700"}`}>
        {diff === 0 ? "-" : `${diff > 0 ? "+" : "−"}${formatYen(Math.abs(diff))}`}
      </td>
      <td className="px-4 py-2 text-right text-xs whitespace-nowrap text-slate-500 tabular-nums">{pct}</td>
    </>
  );
}

function Rows({ rows, kind, empty }: { rows: ComparisonRow[]; kind: "revenue" | "expense"; empty: string }) {
  if (!rows.length) {
    return (
      <tr>
        <td colSpan={5} className="px-4 py-3 text-center text-slate-400">
          {empty}
        </td>
      </tr>
    );
  }
  return (
    <>
      {rows.map((r) => (
        <tr key={r.accountId}>
          <td className="px-4 py-2">
            <Link href={`/ledger?accountId=${r.accountId}`} className="hover:underline">
              {r.code} {r.name}
            </Link>
          </td>
          <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap">{formatYen(r.current)}</td>
          <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap text-slate-500">{formatYen(r.prior)}</td>
          <Change current={r.current} prior={r.prior} kind={kind} />
        </tr>
      ))}
    </>
  );
}

export default async function IncomeStatementPage({ searchParams }: { searchParams: Promise<PeriodParams> }) {
  const companyId = await requireCompanyId();
  const period = resolvePeriod(await searchParams, await getFiscalStartMonth(companyId));
  const [statement, comparison] = await Promise.all([getIncomeStatement(companyId, toRange(period)), getIncomeStatementComparison(companyId, period)]);
  const netLabel = period.preset === "this-fy" || period.preset === "last-fy" ? "当期純利益" : "純利益";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">損益計算書</h1>
          <p className="mt-1 text-sm text-slate-600">
            記帳済みの仕訳から収益・費用を集計し、当期純利益を計算します。確定申告の損益計算の土台として使えます。
          </p>
          <p className="mt-1 text-sm font-medium text-slate-800">{period.label}</p>
          {comparison && (
            <p className="text-xs text-slate-500">
              前年同期({display(comparison.priorPeriod.from)}〜{display(comparison.priorPeriod.to)})と比べています
            </p>
          )}
        </div>
        <CsvDownloadLink href={`/api/income-statement/export?${periodQuery(period)}`} print />
      </div>

      <PeriodPicker path="/income-statement" period={period} />

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          {comparison ? (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs whitespace-nowrap text-slate-500">
                <tr>
                  <th className="px-4 py-2">科目</th>
                  <th className="px-4 py-2 text-right">当期</th>
                  <th className="px-4 py-2 text-right">前年同期</th>
                  <th className="px-4 py-2 text-right">増減</th>
                  <th className="px-4 py-2 text-right">増減率</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                <tr className="bg-slate-50/60">
                  <td colSpan={5} className="px-4 py-1 text-xs font-semibold text-slate-500">
                    収益
                  </td>
                </tr>
                <Rows rows={comparison.revenue} kind="revenue" empty="まだ収益がありません。" />
                <tr className="border-t font-medium">
                  <td className="px-4 py-2">収益合計</td>
                  <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap">{formatYen(comparison.totals.revenue.current)}</td>
                  <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap text-slate-500">{formatYen(comparison.totals.revenue.prior)}</td>
                  <Change {...comparison.totals.revenue} kind="revenue" />
                </tr>
                <tr className="bg-slate-50/60">
                  <td colSpan={5} className="px-4 py-1 text-xs font-semibold text-slate-500">
                    費用
                  </td>
                </tr>
                <Rows rows={comparison.expense} kind="expense" empty="まだ費用がありません。" />
                <tr className="border-t font-medium">
                  <td className="px-4 py-2">費用合計</td>
                  <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap">{formatYen(comparison.totals.expense.current)}</td>
                  <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap text-slate-500">{formatYen(comparison.totals.expense.prior)}</td>
                  <Change {...comparison.totals.expense} kind="expense" />
                </tr>
              </tbody>
              <tfoot className="border-t-2 bg-slate-50 font-semibold">
                <tr>
                  <td className="px-4 py-3">{netLabel}</td>
                  <td className={`px-4 py-3 text-right tabular-nums whitespace-nowrap ${comparison.totals.net.current < 0 ? "text-rose-700" : ""}`}>
                    {formatYen(comparison.totals.net.current)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap text-slate-500">{formatYen(comparison.totals.net.prior)}</td>
                  <Change {...comparison.totals.net} kind="revenue" />
                </tr>
              </tfoot>
            </table>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2">科目</th>
                  <th className="px-4 py-2 text-right">金額</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {[
                  ["収益", statement.revenueRows, statement.totalRevenue, "収益合計"] as const,
                  ["費用", statement.expenseRows, statement.totalExpense, "費用合計"] as const,
                ].map(([title, rows, total, totalLabel]) => (
                  <RowsGroup key={title} title={title} rows={rows} total={total} totalLabel={totalLabel} />
                ))}
              </tbody>
              <tfoot className="border-t-2 bg-slate-50 font-semibold">
                <tr>
                  <td className="px-4 py-3">{netLabel}</td>
                  <td className={`px-4 py-3 text-right whitespace-nowrap ${statement.netIncome < 0 ? "text-rose-700" : ""}`}>{formatYen(statement.netIncome)}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>

      <p className="text-xs text-slate-400">
        総勘定元帳・試算表と同様、記帳済み(自動・手動)の仕訳のみを集計します(レビュー待ち・却下は含みません)。
      </p>
    </div>
  );
}

function RowsGroup({
  title,
  rows,
  total,
  totalLabel,
}: {
  title: string;
  rows: { account: { id: string; code: string; name: string }; balance: number }[];
  total: number;
  totalLabel: string;
}) {
  return (
    <>
      <tr className="bg-slate-50/60">
        <td colSpan={2} className="px-4 py-1 text-xs font-semibold text-slate-500">
          {title}
        </td>
      </tr>
      {rows.map((row) => (
        <tr key={row.account.id}>
          <td className="px-4 py-2">
            <Link href={`/ledger?accountId=${row.account.id}`} className="hover:underline">
              {row.account.code} {row.account.name}
            </Link>
          </td>
          <td className="px-4 py-2 text-right whitespace-nowrap">{formatYen(row.balance)}</td>
        </tr>
      ))}
      {rows.length === 0 && (
        <tr>
          <td colSpan={2} className="px-4 py-3 text-center text-slate-400">
            まだ{title}がありません。
          </td>
        </tr>
      )}
      <tr className="border-t font-medium">
        <td className="px-4 py-2">{totalLabel}</td>
        <td className="px-4 py-2 text-right whitespace-nowrap">{formatYen(total)}</td>
      </tr>
    </>
  );
}

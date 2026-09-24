import { Fragment } from "react";
import Link from "next/link";
import { getAccountBalances } from "@/lib/accounting/ledger";
import { requireCompanyId } from "@/lib/auth/session";
import { formatYen } from "@/lib/format";
import { CsvDownloadLink } from "@/components/CsvDownloadLink";
import { AsOfPicker } from "@/components/PeriodPicker";
import { nextDay, resolveAsOf, type PeriodParams } from "@/lib/accounting/period";

export const dynamic = "force-dynamic";

const CATEGORY_LABELS: Record<string, string> = {
  ASSET: "資産",
  LIABILITY: "負債",
  EQUITY: "純資産",
  REVENUE: "収益",
  EXPENSE: "費用",
};
const CATEGORY_ORDER = ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"];

export default async function TrialBalancePage({ searchParams }: { searchParams: Promise<PeriodParams> }) {
  const companyId = await requireCompanyId();
  const { asOf, label } = resolveAsOf(await searchParams);
  const rows = await getAccountBalances(companyId, { lt: nextDay(asOf) });

  const totalDebit = rows.reduce((sum, row) => sum + row.totalDebit, 0);
  const totalCredit = rows.reduce((sum, row) => sum + row.totalCredit, 0);
  const balanced = totalDebit === totalCredit;

  const grouped = CATEGORY_ORDER.map((category) => ({
    category,
    rows: rows.filter((row) => row.account.category === category && (row.totalDebit > 0 || row.totalCredit > 0)),
  })).filter((group) => group.rows.length > 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">試算表</h1>
          <p className="mt-1 text-sm text-slate-600">
            自動仕訳(AI自動処理・人による承認済み)を勘定科目ごとに集計しています。レビュー待ちの仕訳は含みません。
          </p>
          <p className="mt-1 text-sm font-medium text-slate-800">{label}</p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full whitespace-nowrap px-3 py-1 text-xs font-medium ${
              balanced ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"
            }`}
          >
            {balanced ? "借方・貸方 一致" : "借方・貸方 不一致"}
          </span>
          <CsvDownloadLink href={`/api/trial-balance/export?asOf=${asOf}`} />
        </div>
      </div>

      <AsOfPicker path="/trial-balance" asOf={asOf} />

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2">勘定科目</th>
              <th className="px-4 py-2 text-right">借方合計</th>
              <th className="px-4 py-2 text-right">貸方合計</th>
              <th className="px-4 py-2 text-right">残高</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {grouped.map((group) => (
              <Fragment key={group.category}>
                <tr className="bg-slate-50/60">
                  <td colSpan={4} className="px-4 py-1 text-xs font-semibold text-slate-500">
                    {CATEGORY_LABELS[group.category]}
                  </td>
                </tr>
                {group.rows.map((row) => (
                  <tr key={row.account.id}>
                    <td className="px-4 py-2">
                      <Link href={`/ledger?accountId=${row.account.id}`} className="hover:underline">
                        {row.account.code} {row.account.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-right">{formatYen(row.totalDebit)}</td>
                    <td className="px-4 py-2 text-right">{formatYen(row.totalCredit)}</td>
                    <td className="px-4 py-2 text-right font-medium">
                      {formatYen(row.balance)}
                      <span className="ml-1 text-xs text-slate-400">
                        {row.normalSide === "DEBIT" ? "借方" : "貸方"}
                      </span>
                    </td>
                  </tr>
                ))}
              </Fragment>
            ))}
            {rows.every((row) => row.totalDebit === 0 && row.totalCredit === 0) && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-slate-400">
                  まだ記帳された仕訳がありません。
                </td>
              </tr>
            )}
          </tbody>
          <tfoot className="border-t bg-slate-50 font-medium">
            <tr>
              <td className="px-4 py-2">合計</td>
              <td className="px-4 py-2 text-right">{formatYen(totalDebit)}</td>
              <td className="px-4 py-2 text-right">{formatYen(totalCredit)}</td>
              <td className="px-4 py-2 text-right">-</td>
            </tr>
          </tfoot>
        </table>
        </div>
      </div>
    </div>
  );
}

import Link from "next/link";
import { getAccountBalances, getAccountLedger } from "@/lib/accounting/ledger";
import { getDefaultCompanyId } from "@/lib/demo";
import { formatDate, formatYen } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function LedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ accountId?: string }>;
}) {
  const { accountId } = await searchParams;
  const companyId = await getDefaultCompanyId();
  const accounts = await getAccountBalances(companyId);
  const selectedAccountId = accountId ?? accounts.find((row) => row.totalDebit > 0 || row.totalCredit > 0)?.account.id;
  const ledger = selectedAccountId ? await getAccountLedger(companyId, selectedAccountId) : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">総勘定元帳</h1>
        <p className="mt-1 text-sm text-slate-600">勘定科目を選ぶと、記帳済みの仕訳明細と残高推移が確認できます。</p>
      </div>

      <div className="flex flex-col gap-6 sm:flex-row">
        <aside className="flex gap-1 overflow-x-auto sm:w-56 sm:shrink-0 sm:flex-col sm:space-y-1 sm:overflow-visible">
          {accounts.map((row) => (
            <Link
              key={row.account.id}
              href={`/ledger?accountId=${row.account.id}`}
              className={`shrink-0 rounded px-2 py-1 text-sm whitespace-nowrap sm:block ${
                row.account.id === selectedAccountId ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {row.account.code} {row.account.name}
            </Link>
          ))}
        </aside>

        <div className="flex-1">
          {!ledger ? (
            <p className="text-sm text-slate-400">勘定科目を選択してください。</p>
          ) : (
            <div className="overflow-hidden rounded-lg border bg-white">
              <div className="flex items-center justify-between border-b px-4 py-3">
                <h2 className="font-medium">
                  {ledger.account.code} {ledger.account.name}
                </h2>
                <span className="text-sm">
                  残高: <span className="font-semibold">{formatYen(ledger.closingBalance)}</span>{" "}
                  <span className="text-xs text-slate-400">({ledger.normalSide === "DEBIT" ? "借方" : "貸方"})</span>
                </span>
              </div>
              <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-2">日付</th>
                    <th className="px-4 py-2">摘要</th>
                    <th className="px-4 py-2 text-right">借方</th>
                    <th className="px-4 py-2 text-right">貸方</th>
                    <th className="px-4 py-2 text-right">残高</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {ledger.entries.map((entry) => (
                    <tr key={entry.id}>
                      <td className="px-4 py-2 whitespace-nowrap">{formatDate(entry.date)}</td>
                      <td className="px-4 py-2">{entry.description}</td>
                      <td className="px-4 py-2 text-right">{entry.debit > 0 ? formatYen(entry.debit) : ""}</td>
                      <td className="px-4 py-2 text-right">{entry.credit > 0 ? formatYen(entry.credit) : ""}</td>
                      <td className="px-4 py-2 text-right font-medium">{formatYen(entry.balance)}</td>
                    </tr>
                  ))}
                  {ledger.entries.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                        この勘定科目にはまだ記帳がありません。
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

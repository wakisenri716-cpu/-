import { getDashboardSummary } from "@/lib/dashboard";
import { formatDate, formatPercent, formatYen } from "@/lib/format";
import { StatusBadge } from "@/components/StatusBadge";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const summary = await getDashboardSummary();

  const stats = [
    { label: "AIが自動処理した仕訳", value: summary.autoPosted },
    { label: "人によるレビュー待ち", value: summary.pendingReview },
    { label: "人が承認・修正した仕訳", value: summary.postedManually },
    { label: "自動化率", value: formatPercent(summary.automationRate) },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">ダッシュボード</h1>
        <p className="mt-1 text-sm text-slate-600">
          経費精算・請求書処理の自動仕訳状況です。AIの信頼度が閾値を超えたものは自動で記帳され、
          そうでないものは「レビューキュー」で人の確認を待ちます。
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-lg border bg-white p-4">
            <div className="text-2xl font-semibold">{stat.value}</div>
            <div className="mt-1 text-xs text-slate-500">{stat.label}</div>
          </div>
        ))}
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-3">最近の仕訳</h2>
        <div className="overflow-hidden rounded-lg border bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-2">日付</th>
                  <th className="px-4 py-2">摘要</th>
                  <th className="px-4 py-2">仕訳明細</th>
                  <th className="px-4 py-2">ステータス</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {summary.recentEntries.map((entry) => (
                  <tr key={entry.id}>
                    <td className="px-4 py-2 whitespace-nowrap">{formatDate(entry.date)}</td>
                    <td className="px-4 py-2">{entry.description}</td>
                    <td className="px-4 py-2">
                      <ul className="space-y-0.5">
                        {entry.lines.map((line) => (
                          <li key={line.id} className="whitespace-nowrap">
                            {line.account.code} {line.account.name}{" "}
                            {line.debit > 0 ? `借方 ${formatYen(line.debit)}` : `貸方 ${formatYen(line.credit)}`}
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className="px-4 py-2">
                      <StatusBadge status={entry.status} />
                    </td>
                  </tr>
                ))}
                {summary.recentEntries.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-slate-400">
                      まだ仕訳がありません。経費精算または請求書を登録してください。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

import Link from "next/link";
import { getCashBalance, getDashboardSummary, getMonthlyTrend, getRankings, getTodos } from "@/lib/dashboard";
import { RankList } from "@/components/RankList";
import { requireCompanyId } from "@/lib/auth/session";
import { TrendChart } from "@/components/TrendChart";
import { formatDate, formatPercent, formatYen } from "@/lib/format";
import { StatusBadge } from "@/components/StatusBadge";
import { ChartIcon, DashboardIcon, InboxIcon, ReceiptIcon } from "@/components/icons";

export const dynamic = "force-dynamic";

const TODO_TONES = {
  amber: "bg-amber-100 text-amber-800",
  rose: "bg-rose-100 text-rose-700",
  slate: "bg-slate-100 text-slate-700",
};

export default async function DashboardPage() {
  const companyId = await requireCompanyId();
  const [summary, trend, cash, todos, rankings] = await Promise.all([
    getDashboardSummary(),
    getMonthlyTrend(companyId),
    getCashBalance(companyId),
    getTodos(companyId),
    getRankings(companyId),
  ]);
  const thisMonth = trend[trend.length - 1];
  const lastMonth = trend[trend.length - 2];
  const kpis = [
    { label: "今月の売上", value: thisMonth.revenue, prev: lastMonth.revenue },
    { label: "今月の費用", value: thisMonth.expense, prev: lastMonth.expense },
    { label: "今月の利益", value: thisMonth.profit, prev: lastMonth.profit },
    { label: "現預金の残高", value: cash, prev: null },
  ];

  const stats = [
    { label: "AIが自動処理した仕訳", value: summary.autoPosted, icon: ReceiptIcon, tone: "emerald" as const },
    { label: "人によるレビュー待ち", value: summary.pendingReview, icon: InboxIcon, tone: "amber" as const },
    { label: "人が承認・修正した仕訳", value: summary.postedManually, icon: DashboardIcon, tone: "blue" as const },
    { label: "自動化率", value: formatPercent(summary.automationRate), icon: ChartIcon, tone: "indigo" as const },
  ];

  const toneClasses = {
    emerald: "bg-emerald-50 text-emerald-600",
    amber: "bg-amber-50 text-amber-600",
    blue: "bg-blue-50 text-blue-600",
    indigo: "bg-indigo-50 text-indigo-600",
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">ダッシュボード</h1>
        <p className="mt-1 text-sm text-slate-600">今月の数字、直近12か月の推移、対応が必要なことをまとめて確認できます。</p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpis.map((k) => {
          const diff = k.prev === null ? null : k.value - k.prev;
          return (
            <div key={k.label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-xs text-slate-500">{k.label}</div>
              <div className={`mt-1 text-xl font-semibold tabular-nums sm:text-2xl ${k.value < 0 ? "text-rose-700" : "text-slate-900"}`}>
                {formatYen(k.value)}
              </div>
              {diff !== null && (
                <div className="mt-0.5 text-xs text-slate-500">
                  先月比 {diff >= 0 ? "+" : "-"}
                  {formatYen(Math.abs(diff))}
                </div>
              )}
              {diff === null && <div className="mt-0.5 text-xs text-slate-500">現金+普通預金</div>}
            </div>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm lg:col-span-2">
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <h2 className="font-semibold">売上・費用・利益の推移</h2>
            <span className="text-xs text-slate-500">直近12か月</span>
          </div>
          <TrendChart data={trend} />
        </section>

        <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-2 font-semibold">やることリスト</h2>
          {todos.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">いま対応が必要なことはありません。</p>
          ) : (
            <ul className="divide-y">
              {todos.map((t) => (
                <li key={t.key}>
                  <Link href={t.href} className="flex items-center justify-between gap-3 py-2.5 hover:bg-slate-50">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-900">{t.label}</div>
                      <div className="text-xs text-slate-500">{t.detail}</div>
                    </div>
                    <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${TODO_TONES[t.tone]}`}>
                      {t.key === "payroll" ? "未計上" : `${t.count}件`}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="font-semibold">顧客別の売上(今期・税抜)</h2>
          <p className="mb-3 text-xs text-slate-500">{rankings.fiscalYear}年度の発行請求書から集計</p>
          <RankList items={rankings.customers} color="#2a78d6" empty="今期の請求書はまだありません" />
        </section>
        <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="font-semibold">費用の内訳(今期)</h2>
          <p className="mb-3 text-xs text-slate-500">{rankings.fiscalYear}年度の記帳済みの費用を科目別に集計</p>
          <RankList items={rankings.expenses} color="#eb6834" empty="今期の費用はまだありません" />
        </section>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">AIによる自動処理</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {stats.map((stat) => {
            const Icon = stat.icon;
            return (
              <div key={stat.label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ${toneClasses[stat.tone]}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <div className="mt-2.5 text-2xl font-semibold text-slate-900">{stat.value}</div>
                <div className="mt-0.5 text-xs text-slate-500">{stat.label}</div>
              </div>
            );
          })}
        </div>

      </section>

      <div>
        <h2 className="text-lg font-semibold mb-3">最近の仕訳</h2>
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
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
                    <td className="min-w-[9rem] px-4 py-2">{entry.description}</td>
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

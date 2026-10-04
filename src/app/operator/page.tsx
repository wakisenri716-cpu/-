import Link from "next/link";
import { listCompanies, PHASE_LABELS, recentErrors, requireOperator, summarize } from "@/lib/operator";
import { plans } from "@/lib/billing/plans";
import { formatYen } from "@/lib/format";
import { CompanyActions } from "./CompanyActions";

export const dynamic = "force-dynamic";

const date = (d: Date | null) => (d ? new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric" }).format(d) : "-");
const dateTime = (d: Date) => new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(d);

const PHASE_TONE: Record<string, string> = {
  off: "bg-slate-100 text-slate-600",
  free: "bg-slate-100 text-slate-700",
  trial: "bg-indigo-50 text-indigo-800",
  active: "bg-emerald-50 text-emerald-800",
  past_due: "bg-amber-50 text-amber-900",
  expired: "bg-rose-50 text-rose-800",
};

type Search = { q?: string; phase?: string; tab?: string };

export default async function OperatorPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireOperator();
  const { q, phase, tab } = await searchParams;
  const [all, errors] = await Promise.all([listCompanies(q?.trim() || null), recentErrors(7)]);
  const s = summarize(all);
  const companies = phase ? all.filter((c) => c.phase === phase) : all;
  const p = plans();
  const showErrors = tab === "errors";

  const tiles = [
    { label: "月の売上見込み", value: formatYen(s.mrr), note: `ライト ${s.light}社・スタンダード ${s.standard}社` },
    { label: "契約中", value: `${s.active + s.pastDue}社`, note: s.pastDue ? `うち支払い失敗 ${s.pastDue}社` : "支払い失敗なし" },
    { label: "無料期間中", value: `${s.trial}社`, note: `残り7日以内 ${s.endingSoon}社` },
    { label: "登録した会社", value: `${s.total}社`, note: `今月の新規 ${s.newThisMonth}社・期限切れ ${s.expired}社` },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">運営者メニュー</h1>
        <p className="mt-1 text-sm text-slate-600">このサービスに登録した会社と、契約・売上・本番のエラーの状況です(運営者だけが見られます)。</p>
        {!s.billingEnabled && <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">有料プラン(Stripe)はまだ設定されていません。設定すると、無料期間・契約の状態がここに出ます(BILLING.md)。</p>}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs text-slate-500">{t.label}</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{t.value}</p>
            <p className="mt-1 text-xs text-slate-500">{t.note}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-2 border-b">
        <Link href="/operator" className={`px-3 py-2 text-sm font-medium ${!showErrors ? "border-b-2 border-indigo-600 text-indigo-700" : "text-slate-500"}`}>
          会社({s.total})
        </Link>
        <Link href="/operator?tab=errors" className={`px-3 py-2 text-sm font-medium ${showErrors ? "border-b-2 border-indigo-600 text-indigo-700" : "text-slate-500"}`}>
          エラー(24時間 {errors.last24h}件)
        </Link>
      </div>

      {!showErrors ? (
        <>
          <form className="flex flex-wrap items-center gap-2 text-sm">
            <input name="q" defaultValue={q ?? ""} placeholder="会社名・管理者のメールで検索" className="w-64 max-w-full rounded-md border px-3 py-1.5" />
            <select name="phase" defaultValue={phase ?? ""} className="rounded-md border px-2 py-1.5">
              <option value="">すべての状態</option>
              {Object.entries(PHASE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <button className="rounded-md border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50">絞り込む</button>
          </form>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs whitespace-nowrap text-slate-500">
                  <tr>
                    <th className="px-3 py-2">会社</th>
                    <th className="px-3 py-2">管理者</th>
                    <th className="px-3 py-2">状態</th>
                    <th className="px-3 py-2">期限・更新日</th>
                    <th className="px-3 py-2 text-right">人数</th>
                    <th className="px-3 py-2 text-right">仕訳</th>
                    <th className="px-3 py-2">最後に使った日</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {companies.map((c) => (
                    <tr key={c.id} className="align-top">
                      <td className="min-w-[9rem] px-3 py-2">
                        <span className="font-medium">{c.name}</span>
                        <span className="block text-xs text-slate-500">登録 {date(c.createdAt)}</span>
                      </td>
                      <td className="min-w-[10rem] px-3 py-2 text-xs">
                        {c.admins.slice(0, 2).map((a) => (
                          <span key={a.email} className="block">
                            {a.name}
                            <span className="block text-slate-500">
                              {a.email}
                              {!a.emailVerifiedAt && <span className="ml-1 rounded bg-amber-50 px-1 text-amber-800">未確認</span>}
                            </span>
                          </span>
                        ))}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PHASE_TONE[c.phase]}`}>{PHASE_LABELS[c.phase]}</span>
                        {c.plan && (c.phase === "active" || c.phase === "past_due") && <span className="block pt-1 text-xs text-slate-500">{p[c.plan].name}</span>}
                      </td>
                      <td className="px-3 py-2 text-xs whitespace-nowrap">
                        {c.phase === "active" || c.phase === "past_due" ? (
                          <>
                            更新 {date(c.currentPeriodEnd)}
                            {c.cancelAtPeriodEnd && <span className="block text-rose-700">解約予約</span>}
                          </>
                        ) : c.phase === "trial" ? (
                          <>
                            {date(c.trialEndsAt)}まで
                            <span className={`block ${c.daysLeft <= 7 ? "text-amber-700" : "text-slate-500"}`}>あと{c.daysLeft}日</span>
                          </>
                        ) : c.phase === "expired" ? (
                          `${date(c.trialEndsAt)}に終了`
                        ) : (
                          "-"
                        )}
                      </td>
                      <td className="px-3 py-2 text-right text-xs whitespace-nowrap tabular-nums">
                        {c.members}人<span className="block text-slate-500">うち従業員 {c.staff}</span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{c.entries}</td>
                      <td className="px-3 py-2 text-xs whitespace-nowrap">{date(c.lastSeen)}</td>
                      <td className="px-3 py-2">
                        <CompanyActions id={c.id} name={c.name} billingFree={c.billingFree} />
                      </td>
                    </tr>
                  ))}
                  {companies.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-3 py-8 text-center text-slate-400">
                        当てはまる会社はありません。
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <p className="text-xs text-slate-500">
            月の売上見込みは、契約中(支払い失敗を含む)の会社の月額(税込)の合計です。実際の入金・手数料は Stripe のダッシュボードで確かめてください。「無料にする」はその会社をずっと無料にします(招待した会社・取引先など)。
          </p>
        </>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            本番のサーバーで起きたエラー(直近7日・{errors.total}件)を、同じ内容・同じ画面ごとにまとめています。直せないときは、この画面の内容をそのまま開発の担当(Claude)に見せてください。
          </p>
          {errors.groups.map((g) => (
            <details key={`${g.message}${g.path}`} className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm">
              <summary className="cursor-pointer">
                <span className="mr-2 rounded-full bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700 tabular-nums">{g.count}回</span>
                <span className="font-medium break-all">{g.message}</span>
                <span className="block pt-1 text-xs text-slate-500">
                  {g.method} {g.path ?? "-"} ・ 最後 {dateTime(g.last)}
                  {g.count > 1 && ` ・ 最初 ${dateTime(g.first)}`}
                  {g.digest && ` ・ digest ${g.digest}`}
                </span>
              </summary>
              {g.stack && <pre className="mt-2 max-h-64 overflow-auto rounded bg-slate-50 p-2 text-xs whitespace-pre-wrap text-slate-600">{g.stack}</pre>}
            </details>
          ))}
          {errors.groups.length === 0 && <p className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-500">直近7日のエラーはありません。</p>}
        </div>
      )}
    </div>
  );
}

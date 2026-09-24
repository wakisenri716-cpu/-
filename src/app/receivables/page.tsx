import Link from "next/link";
import { requireCompanyId } from "@/lib/auth/session";
import { BUCKETS, getAging } from "@/lib/accounting/receivables";
import { formatYen } from "@/lib/format";
import { CsvDownloadLink } from "@/components/CsvDownloadLink";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "receivable", label: "売掛金(入金待ち)", direction: "ISSUED", party: "顧客", hint: "発行した請求書のうち、まだ入金されていない金額です。" },
  { key: "payable", label: "買掛金(支払予定)", direction: "RECEIVED", party: "取引先", hint: "受け取った請求書のうち、まだ支払っていない金額です。" },
] as const;

const BUCKET_TONE: Record<string, string> = { notDue: "", d30: "text-amber-700", d60: "text-orange-700", d90: "text-rose-700 font-semibold" };

function fmt(k: string | null) {
  if (!k) return "-";
  const [y, m, d] = k.split("-").map(Number);
  return `${y}/${m}/${d}`;
}

export default async function ReceivablesPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const companyId = await requireCompanyId();
  const { type } = await searchParams;
  const tab = TABS.find((t) => t.key === type) ?? TABS[0];
  const aging = await getAging(companyId, tab.direction);
  const overdue = aging.total - aging.totals.notDue;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">売掛金・買掛金</h1>
          <p className="mt-1 text-sm text-slate-600">{tab.hint}期日を過ぎた日数ごとに分けて表示します(年齢表)。</p>
        </div>
        <CsvDownloadLink href={`/api/receivables/export?type=${tab.key}`} />
      </div>

      <div className="flex gap-2 border-b">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/receivables?type=${t.key}`}
            className={`px-3 py-2 text-sm font-medium ${t.key === tab.key ? "border-b-2 border-indigo-600 text-indigo-700" : "text-slate-500"}`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-500">{tab.direction === "ISSUED" ? "入金待ちの合計" : "支払予定の合計"}</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{formatYen(aging.total)}</div>
          <div className="mt-1 text-xs text-slate-500">{aging.rows.length}件</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-500">期日前</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{formatYen(aging.totals.notDue)}</div>
        </div>
        <div className={`rounded-xl border p-4 shadow-sm ${overdue > 0 ? "border-rose-200 bg-rose-50" : "border-slate-200 bg-white"}`}>
          <div className={`text-xs ${overdue > 0 ? "text-rose-700" : "text-slate-500"}`}>期日を過ぎている</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{formatYen(overdue)}</div>
          {overdue > 0 && (
            <div className="mt-1 text-xs text-rose-700">{tab.direction === "ISSUED" ? "入金の確認・催促をしてください" : "支払漏れがないか確認してください"}</div>
          )}
        </div>
      </div>

      <section className="space-y-2">
        <h2 className="font-semibold">{tab.party}ごとの残高</h2>
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs whitespace-nowrap text-slate-500">
                <tr>
                  <th className="px-4 py-2">{tab.party}</th>
                  <th className="px-4 py-2 text-right">残高合計</th>
                  {BUCKETS.map((b) => (
                    <th key={b.key} className="px-4 py-2 text-right">
                      {b.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {aging.parties.map((p) => (
                  <tr key={p.name}>
                    <td className="px-4 py-2 whitespace-nowrap">
                      {p.name} <span className="text-xs text-slate-400">{p.count}件</span>
                    </td>
                    <td className="px-4 py-2 text-right font-medium tabular-nums whitespace-nowrap">{formatYen(p.total)}</td>
                    {BUCKETS.map((b) => (
                      <td key={b.key} className={`px-4 py-2 text-right tabular-nums whitespace-nowrap ${p.buckets[b.key] ? BUCKET_TONE[b.key] : "text-slate-300"}`}>
                        {p.buckets[b.key] ? formatYen(p.buckets[b.key]) : "-"}
                      </td>
                    ))}
                  </tr>
                ))}
                {aging.parties.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                      残っている{tab.direction === "ISSUED" ? "売掛金" : "買掛金"}はありません。
                    </td>
                  </tr>
                )}
              </tbody>
              {aging.parties.length > 0 && (
                <tfoot className="border-t-2 bg-slate-50 font-semibold">
                  <tr>
                    <td className="px-4 py-2">合計</td>
                    <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap">{formatYen(aging.total)}</td>
                    {BUCKETS.map((b) => (
                      <td key={b.key} className="px-4 py-2 text-right tabular-nums whitespace-nowrap">
                        {formatYen(aging.totals[b.key])}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      </section>

      {aging.rows.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-semibold">請求書ごと(期日の早い順)</h2>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs whitespace-nowrap text-slate-500">
                  <tr>
                    <th className="px-4 py-2">期日</th>
                    <th className="px-4 py-2">{tab.party}</th>
                    <th className="px-4 py-2">請求書番号</th>
                    <th className="px-4 py-2 text-right">請求額</th>
                    <th className="px-4 py-2 text-right">残高</th>
                    <th className="px-4 py-2">状況</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {aging.rows.map((r) => (
                    <tr key={r.id}>
                      <td className="px-4 py-2 whitespace-nowrap">{fmt(r.dueDate)}</td>
                      <td className="px-4 py-2 whitespace-nowrap">{r.partyName}</td>
                      <td className="px-4 py-2 whitespace-nowrap">{r.invoiceNumber ?? "-"}</td>
                      <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap">{formatYen(r.total)}</td>
                      <td className="px-4 py-2 text-right font-medium tabular-nums whitespace-nowrap">{formatYen(r.remaining)}</td>
                      <td className={`px-4 py-2 whitespace-nowrap ${BUCKET_TONE[r.bucket]}`}>{r.overdueDays > 0 ? `${r.overdueDays}日超過` : "期日前"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="text-xs text-slate-500">
            入金・支払の記録は「請求書」画面、または「銀行明細」の取り込み(金額が一致すれば自動で消込)で行います。
          </p>
        </section>
      )}
    </div>
  );
}

import { requireCompanyId } from "@/lib/auth/session";
import { KIND_LABELS, searchDocuments, type DocumentQuery } from "@/lib/documents";
import { formatYen } from "@/lib/format";
import { CsvDownloadLink } from "@/components/CsvDownloadLink";

export const dynamic = "force-dynamic";

const input = "rounded-md border px-2 py-1.5 text-sm";

function fmt(k: string | null) {
  if (!k) return "-";
  const [y, m, d] = k.split("-").map(Number);
  return `${y}/${m}/${d}`;
}

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<DocumentQuery> }) {
  const companyId = await requireCompanyId();
  const q = await searchParams;
  const { rows, truncated } = await searchDocuments(companyId, q);
  const qs = new URLSearchParams(Object.entries(q).filter(([, v]) => typeof v === "string" && v !== "") as [string, string][]).toString();
  const total = rows.reduce((s, r) => s + r.amount, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">証憑の検索</h1>
          <p className="mt-1 text-sm text-slate-600">
            アップロードした領収書・請求書を、取引日・金額・取引先で探せます(電子帳簿保存法の検索要件に対応。日付と金額は範囲で指定でき、組み合わせて検索できます)。
          </p>
        </div>
        <CsvDownloadLink href={`/api/documents/export?${qs}`} print />
      </div>

      <form method="get" className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs text-slate-500">
          取引日
          <span className="mt-1 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1">
            <input type="date" name="from" defaultValue={q.from} className={`${input} w-full min-w-0`} aria-label="取引日(から)" />
            〜
            <input type="date" name="to" defaultValue={q.to} className={`${input} w-full min-w-0`} aria-label="取引日(まで)" />
          </span>
        </label>
        <label className="text-xs text-slate-500">
          金額(円)
          <span className="mt-1 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1">
            <input type="number" name="min" min={0} defaultValue={q.min} placeholder="下限" className={`${input} w-full min-w-0`} aria-label="金額(下限)" />
            〜
            <input type="number" name="max" min={0} defaultValue={q.max} placeholder="上限" className={`${input} w-full min-w-0`} aria-label="金額(上限)" />
          </span>
        </label>
        <label className="text-xs text-slate-500">
          取引先(名前の一部)
          <input name="party" defaultValue={q.party} placeholder="例: 文具" className={`${input} mt-1 block w-full`} />
        </label>
        <label className="text-xs text-slate-500">
          種類
          <select name="kind" defaultValue={q.kind ?? ""} className={`${input} mt-1 block w-full`}>
            <option value="">すべて</option>
            {Object.entries(KIND_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
          <button type="submit" className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700">
            検索
          </button>
          {qs && (
            <a href="/documents" className="rounded-md border px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
              条件をクリア
            </a>
          )}
        </div>
      </form>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b px-4 py-2 text-xs text-slate-500">
          <span>
            {rows.length}件{truncated && "(多すぎるため先頭のみ表示。条件を絞ってください)"}
          </span>
          <span>合計 {formatYen(total)}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs whitespace-nowrap text-slate-500">
              <tr>
                <th className="px-4 py-2">取引日</th>
                <th className="px-4 py-2">種類</th>
                <th className="px-4 py-2">取引先</th>
                <th className="px-4 py-2 text-right">金額</th>
                <th className="px-4 py-2">内容</th>
                <th className="px-4 py-2">証憑</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={`${r.kind}-${r.id}`}>
                  <td className="px-4 py-2 whitespace-nowrap">{fmt(r.date)}</td>
                  <td className="px-4 py-2 whitespace-nowrap">{KIND_LABELS[r.kind]}</td>
                  <td className="px-4 py-2 whitespace-nowrap">{r.party ?? "-"}</td>
                  <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap">{formatYen(r.amount)}</td>
                  <td className="min-w-[10rem] px-4 py-2">{r.description}</td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    {r.href ? (
                      <a href={r.href} target="_blank" rel="noopener noreferrer" className="text-indigo-700 hover:underline">
                        表示
                      </a>
                    ) : (
                      <span className="text-xs text-slate-400">なし</span>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                    条件に合う証憑はありません。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

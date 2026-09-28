"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { formatYen } from "@/lib/format";
import { formatDuration, shiftMonth } from "@/lib/workLogFormat";

type Row = { id: string; name: string; minutes: number; cost: number; by: Record<string, number> };
type Summary = {
  month: string;
  laborCostRate: number | null;
  projects: Row[];
  users: Row[];
  totalMinutes: number;
  totalCost: number;
  zeroRate: number;
  logs: { id: string; date: string; userName: string; projectName: string; minutes: number; task: string | null; hourlyCost: number; cost: number }[];
};

const hours = (m: number) => (m ? (m / 60).toFixed(1) : "");
const cell = "border-b border-slate-100 px-3 py-2";

export function SummaryView() {
  const [month, setMonth] = useState<string | null>(null);
  const [data, setData] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/worklogs/summary${month ? `?month=${month}` : ""}`);
    if (res.ok) setData(await res.json());
  }, [month]);

  useEffect(() => {
    // Fetch-on-mount: setState always lands after the fetch's await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function post(body: object) {
    setBusy(true);
    setError(null);
    setMessage(null);
    const res = await fetch("/api/worklogs/summary", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(json.error || "処理できませんでした");
      return null;
    }
    await load();
    return json;
  }

  async function saveRate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const rate = new FormData(event.currentTarget).get("rate");
    const r = await post({ action: "rate", rate });
    if (r) setMessage(r.rate === null ? "標準の時間単価をなしにしました" : `標準の時間単価を${formatYen(r.rate)}にしました。これからの日報に使います`);
  }

  async function recalc() {
    if (!data || !confirm(`${data.month.replace("-", "年")}月の日報の単価を、今の設定で付け直しますか?`)) return;
    const r = await post({ action: "recalc", month: data.month });
    if (r) setMessage(`${r.count}件の日報の単価を付け直しました`);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm">
            <Link href="/worklogs" className="text-indigo-700 hover:underline">
              ← 自分の日報
            </Link>
          </p>
          <h1 className="mt-1 text-2xl font-semibold">工数の集計</h1>
          <p className="mt-1 text-sm text-slate-600">
            日報をもとに、案件ごと・人ごとの作業時間と労務費(時間 × 時間単価)を集計します。労務費は案件の採算を見るための目安で、仕訳にはなりません。
          </p>
        </div>
        {data && (
          <a href={`/api/worklogs/summary?month=${data.month}&format=csv`} className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50">
            CSVダウンロード
          </a>
        )}
      </div>

      {error && <div className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</div>}
      {message && <div className="rounded-md bg-emerald-50 px-4 py-2 text-sm text-emerald-800">{message}</div>}

      {data && (
        <>
          <div className="flex items-center justify-between gap-2">
            <button onClick={() => setMonth(shiftMonth(data.month, -1))} className="rounded-md border bg-white px-3 py-1 text-sm whitespace-nowrap hover:bg-slate-50">
              ← 前月
            </button>
            <h2 className="font-semibold">
              {Number(data.month.slice(0, 4))}年{Number(data.month.slice(5))}月
            </h2>
            <button onClick={() => setMonth(shiftMonth(data.month, 1))} className="rounded-md border bg-white px-3 py-1 text-sm whitespace-nowrap hover:bg-slate-50">
              翌月 →
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { label: "作業時間の合計", value: formatDuration(data.totalMinutes) },
              { label: "労務費の合計(目安)", value: formatYen(data.totalCost) },
              { label: "記録した人", value: `${data.users.length}人` },
              { label: "案件", value: `${data.projects.filter((p) => p.id).length}件` },
            ].map((t) => (
              <div key={t.label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-xs text-slate-500">{t.label}</p>
                <p className="mt-1 text-xl font-semibold tabular-nums">{t.value}</p>
              </div>
            ))}
          </div>

          <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="font-semibold">時間単価</h2>
            <p className="text-sm text-slate-600">
              タイムカードのスタッフにひも付いている人は、そのスタッフの時給を使います。ひも付いていない人(正社員など)は、下の標準の時間単価を使います。社会保険料なども含めた1時間あたりの人件費を入れると、実態に近くなります。
            </p>
            <form key={data.laborCostRate ?? "none"} onSubmit={saveRate} className="flex flex-wrap items-end gap-2">
              <label className="block text-sm">
                <span className="text-slate-600">標準の時間単価(円)</span>
                <input name="rate" inputMode="numeric" defaultValue={data.laborCostRate ?? ""} placeholder="例: 3000" className="mt-1 w-36 rounded-md border px-3 py-2 text-sm" />
              </label>
              <button disabled={busy} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50">
                保存
              </button>
            </form>
            {data.logs.length > 0 && (
              <div className={`flex flex-wrap items-center justify-between gap-2 rounded-md px-3 py-2 text-sm ${data.zeroRate ? "bg-amber-50 text-amber-900" : "bg-slate-50 text-slate-600"}`}>
                <span>
                  {data.zeroRate
                    ? `この月の日報のうち${data.zeroRate}件は、単価0円のまま記録されています。`
                    : "日報の単価は記録したときの設定です。時給や標準の単価を変えたときは付け直してください。"}
                </span>
                <button onClick={recalc} disabled={busy} className="rounded-md border border-current px-3 py-1 text-xs font-medium">
                  今の単価で計算し直す
                </button>
              </div>
            )}
          </section>

          {data.logs.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">この月の日報はまだありません。メンバーは「日報(工数)」から記録します。</p>
          ) : (
            <>
              <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
                <h2 className="px-5 pt-4 font-semibold">案件ごと</h2>
                <p className="px-5 text-xs text-slate-500">人ごとの列は時間(h)です。</p>
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-slate-500">
                      <tr>
                        <th className={cell}>案件</th>
                        {data.users.map((u) => (
                          <th key={u.id} className={`${cell} text-right whitespace-nowrap`}>
                            {u.name}
                          </th>
                        ))}
                        <th className={`${cell} text-right`}>合計</th>
                        <th className={`${cell} text-right whitespace-nowrap`}>労務費</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.projects.map((p) => (
                        <tr key={p.id || "internal"}>
                          <td className={`${cell} min-w-40`}>
                            {p.id ? (
                              <Link href={`/projects/${p.id}`} className="text-indigo-700 hover:underline">
                                {p.name}
                              </Link>
                            ) : (
                              <span className="text-slate-500">{p.name}</span>
                            )}
                          </td>
                          {data.users.map((u) => (
                            <td key={u.id} className={`${cell} text-right tabular-nums text-slate-600`}>
                              {hours(p.by[u.id] ?? 0)}
                            </td>
                          ))}
                          <td className={`${cell} text-right tabular-nums whitespace-nowrap`}>{formatDuration(p.minutes)}</td>
                          <td className={`${cell} text-right tabular-nums`}>{formatYen(p.cost)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="font-medium">
                      <tr>
                        <td className="px-3 py-2">合計</td>
                        {data.users.map((u) => (
                          <td key={u.id} className="px-3 py-2 text-right tabular-nums">
                            {hours(u.minutes)}
                          </td>
                        ))}
                        <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{formatDuration(data.totalMinutes)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatYen(data.totalCost)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </section>

              <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
                <h2 className="px-5 pt-4 font-semibold">人ごと</h2>
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-slate-500">
                      <tr>
                        <th className={cell}>名前</th>
                        <th className={`${cell} text-right`}>作業時間</th>
                        <th className={`${cell} text-right`}>うち案件</th>
                        <th className={`${cell} text-right`}>労務費</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.users.map((u) => {
                        const onProjects = u.minutes - (u.by[""] ?? 0);
                        return (
                          <tr key={u.id}>
                            <td className={cell}>{u.name}</td>
                            <td className={`${cell} text-right tabular-nums whitespace-nowrap`}>{formatDuration(u.minutes)}</td>
                            <td className={`${cell} text-right tabular-nums text-slate-600`}>{Math.round((onProjects / u.minutes) * 100)}%</td>
                            <td className={`${cell} text-right tabular-nums`}>{formatYen(u.cost)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>

              <details className="rounded-xl border border-slate-200 bg-white shadow-sm">
                <summary className="cursor-pointer px-5 py-4 font-semibold">日報の一覧({data.logs.length}件)</summary>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-slate-500">
                      <tr>
                        <th className={cell}>日付</th>
                        <th className={cell}>名前</th>
                        <th className={cell}>案件</th>
                        <th className={cell}>作業内容</th>
                        <th className={`${cell} text-right`}>時間</th>
                        <th className={`${cell} text-right`}>労務費</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.logs.map((l) => (
                        <tr key={l.id}>
                          <td className={`${cell} whitespace-nowrap`}>{`${Number(l.date.slice(5, 7))}/${Number(l.date.slice(8))}`}</td>
                          <td className={`${cell} whitespace-nowrap`}>{l.userName}</td>
                          <td className={cell}>{l.projectName}</td>
                          <td className={`${cell} text-slate-600`}>{l.task}</td>
                          <td className={`${cell} text-right tabular-nums whitespace-nowrap`}>{formatDuration(l.minutes)}</td>
                          <td className={`${cell} text-right tabular-nums`} title={`時間単価 ${formatYen(l.hourlyCost)}`}>
                            {formatYen(l.cost)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </>
          )}
        </>
      )}
    </div>
  );
}

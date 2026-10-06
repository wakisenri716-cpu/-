"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { formatYen } from "@/lib/format";

type Run = { id: string; month: string; amount: number; detail: { departmentId: string; name: string; ratio: number; amount: number }[]; createdAt: string };
type Allocation = { id: string; name: string; accountCodes: string[]; basis: "FIXED" | "REVENUE"; weights: Record<string, number>; active: boolean; runs: Run[] };
type Department = { id: string; name: string; active: boolean };
type Account = { code: string; name: string };
type Data = { allocations: Allocation[]; departments: Department[]; accounts: Account[] };
type Draft = { id?: string; name: string; accountCodes: string[]; basis: "FIXED" | "REVENUE"; weights: Record<string, string> };
type Preview = {
  month: string;
  total: number;
  accounts: { code: string; name: string; amount: number }[];
  departments: { id: string; name: string; weight: number; ratio: number; amount: number }[];
  problem: string | null;
  run: { id: string } | null;
};

const BASIS_LABELS = { FIXED: "決めた割合(面積・人数など)", REVENUE: "その月の売上の比" };
const pct = (r: number) => `${Math.round(r * 1000) / 10}%`;
const monthLabel = (m: string) => `${m.slice(0, 4)}年${Number(m.slice(5))}月`;

// 既定は先月(月が締まってから配賦することが多いため)
function lastMonth() {
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());
  const [y, m] = today.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function AllocationView() {
  const [data, setData] = useState<Data | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [month, setMonth] = useState(lastMonth);
  const [previews, setPreviews] = useState<Record<string, Preview | null>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/cost-allocations");
    if (res.ok) setData(await res.json());
  }, []);

  const loadPreviews = useCallback(async (list: Allocation[], m: string) => {
    const entries = await Promise.all(
      list.map(async (a) => {
        const res = await fetch(`/api/cost-allocations/${a.id}?month=${m}`);
        return [a.id, res.ok ? ((await res.json()) as Preview) : null] as const;
      }),
    );
    setPreviews(Object.fromEntries(entries));
  }, []);

  useEffect(() => {
    // Fetch-on-mount: setState always lands after the fetch's await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (data) loadPreviews(data.allocations, month);
  }, [data, month, loadPreviews]);

  async function send(url: string, method: string, body?: object) {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) setMessage({ ok: false, text: json.error || "処理できませんでした" });
    return res.ok ? json : null;
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setBusy(true);
    setMessage(null);
    const saved = await send(draft.id ? `/api/cost-allocations/${draft.id}` : "/api/cost-allocations", draft.id ? "PATCH" : "POST", draft);
    setBusy(false);
    if (!saved) return;
    setDraft(null);
    setMessage({ ok: true, text: `「${saved.name}」を${draft.id ? "変更" : "登録"}しました。月を選んで「配賦する」を押すと仕訳を作ります。` });
    await load();
  }

  async function run(a: Allocation) {
    const p = previews[a.id];
    if (!p || !confirm(`${monthLabel(month)}の「${a.name}」${formatYen(p.total)}を、部門に配賦する仕訳を作りますか?`)) return;
    setBusy(true);
    setMessage(null);
    const r = await send(`/api/cost-allocations/${a.id}`, "POST", { month });
    setBusy(false);
    if (r) setMessage({ ok: true, text: `${monthLabel(month)}の「${a.name}」を配賦しました(${formatYen(r.amount)})。部門別損益に反映されています。` });
    await load();
  }

  async function undo(a: Allocation, r: Run) {
    if (!confirm(`${monthLabel(r.month)}の「${a.name}」の配賦を取り消しますか?(配賦の仕訳を取消にします)`)) return;
    setMessage(null);
    if (await send(`/api/cost-allocations/runs/${r.id}`, "DELETE")) {
      setMessage({ ok: true, text: `${monthLabel(r.month)}の配賦を取り消しました。` });
      await load();
    }
  }

  async function remove(a: Allocation) {
    if (!confirm(`「${a.name}」の設定を削除しますか?`)) return;
    setMessage(null);
    if (await send(`/api/cost-allocations/${a.id}`, "DELETE")) await load();
  }

  if (!data) return null;
  const activeDepartments = data.departments.filter((d) => d.active);
  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const draftTotal = draft ? Object.values(draft.weights).reduce((s, v) => s + (Number(v) || 0), 0) : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/departments" className="text-sm text-indigo-700 hover:underline">
            ← 部門別損益
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">共通費の配賦</h1>
          <p className="mt-1 text-sm text-slate-600">
            本部の家賃・水道光熱費など、部門の付いていない共通の費用を、決めた割合かその月の売上の比で部門(店舗)に振り分けます。配賦すると部門別損益で、共通費を負担したあとの部門ごとの利益がわかります。
          </p>
        </div>
        <button
          onClick={() => setDraft({ name: "", accountCodes: [], basis: "FIXED", weights: Object.fromEntries(activeDepartments.map((d) => [d.id, ""])) })}
          disabled={activeDepartments.length < 2}
          className="rounded-md bg-vermilion-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-vermilion-700 disabled:opacity-50"
        >
          配賦の設定を追加
        </button>
      </div>

      {activeDepartments.length < 2 && (
        <div className="rounded-md bg-amber-50 px-4 py-2 text-sm text-amber-900">
          配賦するには、部門が2つ以上必要です。
          <Link href="/departments" className="ml-1 underline">
            部門別損益
          </Link>
          の画面で部門(店舗など)を登録してください。
        </div>
      )}
      {message && <div className={`rounded-md px-4 py-2 text-sm ${message.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"}`}>{message.text}</div>}

      {draft && (
        <form onSubmit={save} className="space-y-4 rounded-xl border border-indigo-200 bg-white p-4 shadow-sm">
          <h2 className="font-semibold">{draft.id ? "配賦の設定を変更" : "配賦の設定を追加"}</h2>
          <label className="block text-sm">
            <span className="text-slate-600">名前</span>
            <input value={draft.name} onChange={(e) => set({ name: e.target.value })} required maxLength={30} placeholder="例: 本部の家賃・光熱費" className="mt-1 w-full rounded-md border px-3 py-2 sm:max-w-sm" />
          </label>
          <fieldset className="text-sm">
            <legend className="text-slate-600">配賦する費用の科目(部門の付いていない分だけを振り分けます)</legend>
            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3 lg:grid-cols-4">
              {data.accounts.map((a) => (
                <label key={a.code} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={draft.accountCodes.includes(a.code)}
                    onChange={(e) => set({ accountCodes: e.target.checked ? [...draft.accountCodes, a.code] : draft.accountCodes.filter((c) => c !== a.code) })}
                  />
                  <span className="truncate">
                    {a.code} {a.name}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="text-sm">
            <legend className="text-slate-600">分け方</legend>
            <div className="mt-2 flex flex-wrap gap-4">
              {(Object.keys(BASIS_LABELS) as ("FIXED" | "REVENUE")[]).map((b) => (
                <label key={b} className="flex items-center gap-1">
                  <input type="radio" checked={draft.basis === b} onChange={() => set({ basis: b, weights: Object.fromEntries(activeDepartments.map((d) => [d.id, b === "REVENUE" ? "1" : (draft.weights[d.id] ?? "")])) })} />
                  {BASIS_LABELS[b]}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="text-sm">
            <legend className="text-slate-600">{draft.basis === "FIXED" ? "部門ごとの割合(合計が100でなくても、比で分けます)" : "配賦先の部門"}</legend>
            <div className="mt-2 space-y-2">
              {activeDepartments.map((d) =>
                draft.basis === "FIXED" ? (
                  <label key={d.id} className="flex items-center gap-2">
                    <span className="w-32 truncate">{d.name}</span>
                    <input
                      value={draft.weights[d.id] ?? ""}
                      onChange={(e) => set({ weights: { ...draft.weights, [d.id]: e.target.value } })}
                      inputMode="decimal"
                      placeholder="0"
                      className="w-24 rounded-md border px-2 py-1 text-right"
                    />
                    <span className="text-xs text-slate-500">{draftTotal > 0 && Number(draft.weights[d.id]) > 0 ? pct(Number(draft.weights[d.id]) / draftTotal) : ""}</span>
                  </label>
                ) : (
                  <label key={d.id} className="flex items-center gap-2">
                    <input type="checkbox" checked={draft.weights[d.id] === "1"} onChange={(e) => set({ weights: { ...draft.weights, [d.id]: e.target.checked ? "1" : "" } })} />
                    {d.name}
                  </label>
                ),
              )}
            </div>
          </fieldset>
          <div className="flex gap-2">
            <button disabled={busy} className="rounded-md bg-vermilion-600 px-4 py-2 text-sm font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
              {draft.id ? "変更する" : "登録する"}
            </button>
            <button type="button" onClick={() => setDraft(null)} className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
              やめる
            </button>
          </div>
        </form>
      )}

      {data.allocations.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-600">配賦する月</span>
          <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className="rounded-md border px-2 py-1" />
        </div>
      )}

      <div className="space-y-4">
        {data.allocations.map((a) => {
          const p = previews[a.id];
          const doneRun = a.runs.find((r) => r.month === month);
          return (
            <section key={a.id} className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm ${a.active ? "" : "opacity-60"}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="font-semibold">
                    {a.name}
                    {!a.active && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-normal text-slate-600">停止中</span>}
                  </h2>
                  <p className="text-xs text-slate-500">
                    {BASIS_LABELS[a.basis]} / 科目: {a.accountCodes.map((c) => data.accounts.find((x) => x.code === c)?.name ?? c).join("・")}
                  </p>
                </div>
                <div className="flex gap-3 text-xs">
                  <button
                    onClick={() =>
                      setDraft({
                        id: a.id,
                        name: a.name,
                        accountCodes: a.accountCodes,
                        basis: a.basis,
                        weights: Object.fromEntries(activeDepartments.map((d) => [d.id, a.weights[d.id] ? String(a.weights[d.id]) : ""])),
                      })
                    }
                    className="text-indigo-700 hover:underline"
                  >
                    編集
                  </button>
                  <button onClick={() => send(`/api/cost-allocations/${a.id}`, "PATCH", { active: !a.active }).then((r) => r && load())} className="text-slate-500 hover:underline">
                    {a.active ? "止める" : "再開"}
                  </button>
                  <button onClick={() => remove(a)} className="text-slate-500 hover:text-rose-700 hover:underline">
                    削除
                  </button>
                </div>
              </div>

              {p && (
                <div className="mt-3 space-y-2">
                  {!doneRun && (
                    <p className="text-sm">
                      {monthLabel(month)}の部門の付いていない対象の費用: <span className="font-semibold tabular-nums">{formatYen(p.total)}</span>
                      {p.accounts.length > 0 && <span className="text-xs text-slate-500">({p.accounts.map((x) => `${x.name} ${formatYen(x.amount)}`).join("・")})</span>}
                    </p>
                  )}
                  <div className="overflow-x-auto">
                    <table className="text-sm">
                      <thead className="text-xs text-slate-500">
                        <tr>
                          <th className="py-1 pr-6 text-left font-medium">部門</th>
                          <th className="py-1 pr-6 text-right font-medium">{a.basis === "REVENUE" ? "売上" : "割合"}</th>
                          <th className="py-1 pr-6 text-right font-medium">比率</th>
                          <th className="py-1 text-right font-medium">配賦額</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(doneRun ? doneRun.detail.map((d) => ({ id: d.departmentId, name: d.name, weight: null as number | null, ratio: d.ratio, amount: d.amount })) : p.departments).map((d) => (
                          <tr key={d.id}>
                            <td className="py-1 pr-6 whitespace-nowrap">{d.name}</td>
                            <td className="py-1 pr-6 text-right tabular-nums whitespace-nowrap">{d.weight == null ? "-" : a.basis === "REVENUE" ? formatYen(d.weight) : d.weight}</td>
                            <td className="py-1 pr-6 text-right tabular-nums">{pct(d.ratio)}</td>
                            <td className="py-1 text-right tabular-nums whitespace-nowrap">{formatYen(d.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {doneRun ? (
                    <div className="flex flex-wrap items-center gap-3 text-sm">
                      <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-800">✓ {monthLabel(month)}は配賦済み({formatYen(doneRun.amount)})</span>
                      <button onClick={() => undo(a, doneRun)} className="text-xs text-slate-500 hover:text-rose-700 hover:underline">
                        配賦を取り消す
                      </button>
                    </div>
                  ) : p.problem ? (
                    <p className="text-sm text-slate-500">{p.problem}</p>
                  ) : (
                    <button onClick={() => run(a)} disabled={busy} className="rounded-md bg-vermilion-600 px-4 py-2 text-sm font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
                      {monthLabel(month)}を配賦する
                    </button>
                  )}
                </div>
              )}

              {a.runs.length > 0 && (
                <p className="mt-3 text-xs text-slate-500">
                  配賦した月: {a.runs.map((r) => `${monthLabel(r.month)}(${formatYen(r.amount)})`).join("、")}
                </p>
              )}
            </section>
          );
        })}
        {data.allocations.length === 0 && activeDepartments.length >= 2 && (
          <p className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-500">まだ配賦の設定がありません。「配賦の設定を追加」から作ってください。</p>
        )}
      </div>

      <p className="text-xs text-slate-500">
        仕組み: 配賦すると、①部門なしで「配賦仮勘定 / 費用」(共通費を部門なしから外す)、②部門ごとに「費用 / 配賦仮勘定」の仕訳を作ります。配賦仮勘定は必ず0に戻り、会社全体の費用は変わりません。端数は割合のいちばん大きい部門に寄せます。同じ月は1回だけ配賦でき、取り消すとやり直せます。
      </p>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { formatYen } from "@/lib/format";

type Route = { id: string; name: string; fromPlace: string; toPlace: string; via: string | null; fare: number; roundTrip: boolean };
type Recent = { id: string; description: string; amount: number; date: string | null; reimbursed: boolean };
type Data = { today: string; routes: Route[]; recent: Recent[] };

const WEEK = ["日", "月", "火", "水", "木", "金", "土"];
const emptyRoute = { name: "", fromPlace: "", toPlace: "", via: "", fare: "", roundTrip: true };

function shift(ym: string, n: number) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function TransportView() {
  const [data, setData] = useState<Data | null>(null);
  const [routeId, setRouteId] = useState("");
  const [month, setMonth] = useState("");
  const [dates, setDates] = useState<Set<string>>(new Set());
  const [oneWay, setOneWay] = useState(false);
  const [purpose, setPurpose] = useState("");
  const [form, setForm] = useState(emptyRoute);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/transport");
    if (!res.ok) return;
    const d: Data = await res.json();
    setData(d);
    setMonth((m) => m || d.today.slice(0, 7));
    setRouteId((id) => (d.routes.some((r) => r.id === id) ? id : (d.routes[0]?.id ?? "")));
    setShowForm((s) => s || d.routes.length === 0);
  }, []);

  useEffect(() => {
    // Fetch-on-mount: setState always lands after the fetch's await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function call(url: string, method: string, body: object | null) {
    setBusy(true);
    setMessage(null);
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setMessage({ ok: false, text: json.error || "できませんでした" });
      return null;
    }
    return json;
  }

  async function saveRoute(e: React.FormEvent) {
    e.preventDefault();
    const json = await call("/api/transport/routes", "POST", form);
    if (!json) return;
    setForm(emptyRoute);
    setShowForm(false);
    setRouteId(json.id);
    setMessage({ ok: true, text: "経路を登録しました。" });
    await load();
  }

  async function removeRoute(r: Route) {
    if (!confirm(`「${r.name}」を削除しますか?(入れた交通費は消えません)`)) return;
    if (await call(`/api/transport/routes/${r.id}`, "DELETE", null)) await load();
  }

  async function submit() {
    const json = await call("/api/transport", "POST", { routeId, dates: [...dates], oneWay, purpose });
    if (!json) return;
    setMessage({ ok: true, text: `${dates.size}日分の交通費 ${formatYen(json.total)} を経費精算に入れました。` });
    setDates(new Set());
    setPurpose("");
    await load();
  }

  if (!data) return null;
  const route = data.routes.find((r) => r.id === routeId) ?? null;
  const perDay = route ? route.fare * (route.roundTrip && !oneWay ? 2 : 1) : 0;
  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`)];
  const inputClass = "mt-1 w-full rounded-md border px-2 py-1.5";

  function toggle(d: string) {
    setDates((s) => {
      const n = new Set(s);
      if (n.has(d)) n.delete(d);
      else n.add(d);
      return n;
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">交通費精算</h1>
        <p className="mt-1 text-sm text-slate-600">よく使う経路を登録しておくと、乗った日を選ぶだけで交通費を経費精算(旅費交通費)に入れられます。1日1行の明細になります。</p>
      </div>

      {message && (
        <div className={`rounded-md px-4 py-2 text-sm ${message.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"}`}>
          {message.text}
          {message.ok && message.text.includes("経費精算に入れました") && (
            <Link href="/expenses" className="ml-2 font-medium underline">
              経費精算を開く
            </Link>
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
          <h2 className="font-semibold">乗った日を選ぶ</h2>
          {data.routes.length === 0 ? (
            <p className="text-slate-500">先に右の「経路を登録」から、よく使う経路を入れてください。</p>
          ) : (
            <>
              <label className="block">
                <span className="text-slate-600">経路</span>
                <select value={routeId} onChange={(e) => setRouteId(e.target.value)} className={inputClass}>
                  {data.routes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}(片道 {r.fare.toLocaleString()}円{r.roundTrip ? "・往復" : ""})
                    </option>
                  ))}
                </select>
              </label>
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <button onClick={() => setMonth(shift(month, -1))} className="rounded-md border px-2 py-1 hover:bg-slate-50" aria-label="前の月">
                    ◀
                  </button>
                  <span className="font-medium">
                    {y}年{m}月
                  </span>
                  <button onClick={() => setMonth(shift(month, 1))} disabled={month >= data.today.slice(0, 7)} className="rounded-md border px-2 py-1 hover:bg-slate-50 disabled:opacity-30" aria-label="次の月">
                    ▶
                  </button>
                </div>
                <div className="grid grid-cols-7 gap-1 text-center">
                  {WEEK.map((w, i) => (
                    <span key={w} className={`text-xs ${i === 0 ? "text-rose-600" : i === 6 ? "text-sky-600" : "text-slate-500"}`}>
                      {w}
                    </span>
                  ))}
                  {cells.map((d, i) =>
                    d === null ? (
                      <span key={`e${i}`} />
                    ) : (
                      <button
                        key={d}
                        disabled={d > data.today}
                        onClick={() => toggle(d)}
                        aria-pressed={dates.has(d)}
                        aria-label={`${Number(d.slice(8))}日`}
                        className={`rounded-md py-2 text-sm tabular-nums disabled:text-slate-300 ${dates.has(d) ? "bg-indigo-600 font-semibold text-white" : "hover:bg-slate-100"}`}
                      >
                        {Number(d.slice(8))}
                      </button>
                    ),
                  )}
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="text-slate-600">目的(任意)</span>
                  <input value={purpose} onChange={(e) => setPurpose(e.target.value)} maxLength={60} placeholder="例: A社 定例会議" className={inputClass} />
                </label>
                {route?.roundTrip && (
                  <label className="mt-6 flex items-center gap-2">
                    <input type="checkbox" checked={oneWay} onChange={(e) => setOneWay(e.target.checked)} />
                    片道だけ
                  </label>
                )}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
                <span>
                  {dates.size}日 × {formatYen(perDay)}
                </span>
                <span className="text-lg font-semibold tabular-nums">{formatYen(dates.size * perDay)}</span>
              </div>
              <button disabled={busy || !route || dates.size === 0} onClick={submit} className="w-full rounded-md bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
                経費精算に入れる
              </button>
              <p className="text-xs text-slate-500">通勤定期の区間は会社から通勤手当が出ているので入れないでください。</p>
            </>
          )}
        </section>

        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">よく使う経路</h2>
            {!showForm && (
              <button onClick={() => setShowForm(true)} className="text-indigo-700 hover:underline">
                + 経路を登録
              </button>
            )}
          </div>
          <ul className="divide-y">
            {data.routes.map((r) => (
              <li key={r.id} className="flex items-start justify-between gap-2 py-2">
                <span>
                  {r.name}
                  <span className="block text-xs text-slate-500">
                    {r.fromPlace}
                    {r.via ? `(${r.via}経由)` : ""}→{r.toPlace}・片道 {r.fare.toLocaleString()}円{r.roundTrip ? "・往復" : "・片道"}
                  </span>
                </span>
                <button onClick={() => removeRoute(r)} className="text-xs text-slate-400 hover:text-rose-700 hover:underline">
                  削除
                </button>
              </li>
            ))}
          </ul>
          {showForm && (
            <form onSubmit={saveRoute} className="space-y-2 rounded-lg border border-slate-200 p-3">
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-slate-600">出発</span>
                  <input value={form.fromPlace} onChange={(e) => setForm({ ...form, fromPlace: e.target.value })} required maxLength={40} placeholder="例: 新宿" className={inputClass} />
                </label>
                <label className="block">
                  <span className="text-slate-600">到着</span>
                  <input value={form.toPlace} onChange={(e) => setForm({ ...form, toPlace: e.target.value })} required maxLength={40} placeholder="例: 横浜" className={inputClass} />
                </label>
                <label className="block">
                  <span className="text-slate-600">経由(任意)</span>
                  <input value={form.via} onChange={(e) => setForm({ ...form, via: e.target.value })} maxLength={40} placeholder="例: 渋谷" className={inputClass} />
                </label>
                <label className="block">
                  <span className="text-slate-600">片道の運賃(円)</span>
                  <input value={form.fare} onChange={(e) => setForm({ ...form, fare: e.target.value })} required inputMode="numeric" placeholder="例: 480" className={inputClass} />
                </label>
              </div>
              <label className="block">
                <span className="text-slate-600">名前(任意)</span>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={40} placeholder="例: A社 訪問" className={inputClass} />
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.roundTrip} onChange={(e) => setForm({ ...form, roundTrip: e.target.checked })} />
                いつもは往復
              </label>
              <div className="flex gap-2">
                <button disabled={busy} className="flex-1 rounded-md bg-indigo-600 px-3 py-2 font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
                  登録する
                </button>
                {data.routes.length > 0 && (
                  <button type="button" onClick={() => setShowForm(false)} className="rounded-md border px-3 py-2 text-slate-600 hover:bg-slate-50">
                    やめる
                  </button>
                )}
              </div>
              <p className="text-xs text-slate-500">運賃はICカードの運賃など、実際にかかる金額を入れてください。</p>
            </form>
          )}
        </section>
      </div>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <h2 className="border-b px-4 py-2 text-sm font-semibold">最近入れた交通費</h2>
        <ul className="divide-y text-sm">
          {data.recent.map((r) => (
            <li key={r.id} className="flex items-start justify-between gap-3 px-4 py-2">
              <span>
                <span className="mr-2 text-slate-500 tabular-nums">{r.date?.replaceAll("-", "/")}</span>
                {r.description}
                {r.reimbursed && <span className="ml-1 rounded bg-emerald-100 px-1 text-xs text-emerald-800">精算済み</span>}
              </span>
              <span className="whitespace-nowrap tabular-nums">{formatYen(r.amount)}</span>
            </li>
          ))}
          {data.recent.length === 0 && <li className="px-4 py-6 text-center text-slate-400">まだありません。</li>}
        </ul>
      </section>
    </div>
  );
}

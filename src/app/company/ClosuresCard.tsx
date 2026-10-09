"use client";

import { useState } from "react";

type Closure = { date: string; name: string };
const WEEK = "日月火水木金土";
const label = (k: string) => `${Number(k.slice(5, 7))}/${Number(k.slice(8, 10))}(${WEEK[new Date(`${k}T00:00:00Z`).getUTCDay()]})`;
const input = "mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm";

// 続いている同じ名前の日をまとめて1行にする
function groups(list: Closure[]) {
  const out: { name: string; dates: string[] }[] = [];
  for (const c of list) {
    const last = out[out.length - 1];
    const prev = last?.dates[last.dates.length - 1];
    const next = prev ? new Date(Date.parse(`${prev}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10) : null;
    if (last && last.name === c.name && next === c.date) last.dates.push(c.date);
    else out.push({ name: c.name, dates: [c.date] });
  }
  return out;
}

// 会社の休業日(夏季休業・創立記念日など)
export function ClosuresCard({ initial, today }: { initial: Closure[]; today: string }) {
  const [list, setList] = useState(initial);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [name, setName] = useState("夏季休業");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(method: "POST" | "DELETE", body: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/company/closures", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "保存できませんでした");
      setList(data.closures);
      if (method === "POST") {
        setFrom("");
        setTo("");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存できませんでした");
    } finally {
      setBusy(false);
    }
  }

  const upcoming = groups(list.filter((c) => c.date >= today));
  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm sm:p-6">
      <div>
        <h2 className="text-lg font-semibold">会社の休業日</h2>
        <p className="mt-1 text-slate-600">夏季休業・創立記念日など、土日・祝日・年末年始(12/29〜1/3)のほかに会社が休む日です。日程調整の候補、朝のまとめの連休前の知らせ、営業日の数え方に使います(税金・銀行の期限は国の祝日で決めます)。</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
        <label className="block">
          <span className="text-slate-600">名前</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={30} placeholder="夏季休業" className={input} />
        </label>
        <label className="block">
          <span className="text-slate-600">始まり</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={input} />
        </label>
        <label className="block">
          <span className="text-slate-600">終わり(1日だけなら空)</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={input} />
        </label>
        <button onClick={() => call("POST", { from, to: to || from, name })} disabled={busy || !from} className="rounded-md bg-vermilion-600 px-4 py-2 font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
          入れる
        </button>
      </div>
      {error && <p className="rounded-md bg-rose-50 px-3 py-2 text-rose-800">{error}</p>}
      {upcoming.length ? (
        <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
          {upcoming.map((g) => (
            <li key={g.dates[0]} className="flex flex-wrap items-center gap-3 px-3 py-2">
              <span className="font-medium">{g.name}</span>
              <span className="tabular-nums text-slate-600">
                {label(g.dates[0])}
                {g.dates.length > 1 ? `〜${label(g.dates[g.dates.length - 1])}(${g.dates.length}日)` : ""}
              </span>
              <button onClick={() => call("DELETE", { dates: g.dates })} disabled={busy} className="ml-auto text-xs text-slate-500 hover:text-rose-700">
                消す
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-slate-500">これからの休業日はまだありません。</p>
      )}
    </section>
  );
}

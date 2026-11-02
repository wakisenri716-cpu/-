"use client";

import { useState } from "react";

type License = { id: string; holderUserId: string | null; holderName: string; name: string; kind: string; number: string | null; expiresOn: string | null; checkedOn: string | null; note: string | null; state: "OK" | "SOON" | "EXPIRED"; days: number | null };
type Data = { licenses: License[]; unlicensedDrivers: { name: string; reason: string }[] };
type Draft = { id?: string; holderUserId: string | null; holderName: string; name: string; number: string | null; expiresOn: string | null; checkedOn?: string | null };

const input = "w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm";
const ymd = (k: string | null) => (k ? `${Number(k.slice(0, 4))}/${Number(k.slice(5, 7))}/${Number(k.slice(8, 10))}` : "期限なし");

export default function LicensesView({ initial, users }: { initial: Data; users: { id: string; name: string }[] }) {
  const [data, setData] = useState(initial);
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  async function call(url: string, method: string, body?: unknown) {
    const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "うまくいきませんでした");
    return json;
  }
  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setError(null);
    setFlash(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "うまくいきませんでした");
    } finally {
      setBusy(null);
    }
  }
  const reload = async () => setData(await call("/api/licenses", "GET"));
  const parse = () => run("parse", async () => setDraft((await call("/api/licenses", "POST", { action: "parse", text })).draft));
  const save = () =>
    run("save", async () => {
      if (!draft) return;
      const { license } = draft.id ? await call(`/api/licenses/${draft.id}`, "PATCH", draft) : await call("/api/licenses", "POST", draft);
      setFlash(`${license.holderName}さんの${license.name}を${draft.id ? "直しました" : "記録しました"}`);
      setDraft(null);
      setText("");
      await reload();
    });
  const remove = (l: License) =>
    run(l.id, async () => {
      if (!confirm(`${l.holderName}さんの${l.name}の記録を消しますか?`)) return;
      await call(`/api/licenses/${l.id}`, "DELETE");
      await reload();
    });

  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm sm:p-6">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && text.trim() && parse()} placeholder="例: 山田 花子 普通自動車免許 2028/3/31まで" className={input} />
          <button onClick={parse} disabled={!!busy || !text.trim()} className="shrink-0 rounded-md bg-vermilion-600 px-4 py-2 font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
            {busy === "parse" ? "読み取っています…" : "読み取る"}
          </button>
        </div>
        {draft && (
          <div className="space-y-2 rounded-md border border-slate-200 p-3">
            <div className="grid gap-2 sm:grid-cols-[12rem_1fr_9rem_10rem_10rem]">
              <select aria-label="持っている人" value={draft.holderUserId ?? ""} onChange={(e) => setDraft({ ...draft, holderUserId: e.target.value || null, holderName: users.find((u) => u.id === e.target.value)?.name ?? draft.holderName })} className={input}>
                <option value="">{draft.holderName ? `${draft.holderName}(社外・アカウントなし)` : "持っている人を選ぶ"}</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
              <input aria-label="資格・免許" placeholder="資格・免許の名前" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={input} />
              <input aria-label="番号" placeholder="番号(下4けたなど)" value={draft.number ?? ""} onChange={(e) => setDraft({ ...draft, number: e.target.value || null })} className={input} />
              <label className="text-xs text-slate-600">
                有効期限
                <input aria-label="有効期限" type="date" value={draft.expiresOn ?? ""} onChange={(e) => setDraft({ ...draft, expiresOn: e.target.value || null })} className={input} />
              </label>
              <label className="text-xs text-slate-600">
                原本・写しを確かめた日
                <input aria-label="確かめた日" type="date" value={draft.checkedOn ?? ""} onChange={(e) => setDraft({ ...draft, checkedOn: e.target.value || null })} className={input} />
              </label>
            </div>
            <div className="flex gap-2">
              <button onClick={save} disabled={!!busy} className="rounded-md bg-vermilion-600 px-4 py-2 font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
                {busy === "save" ? "保存しています…" : draft.id ? "直す" : "記録する"}
              </button>
              <button onClick={() => setDraft(null)} className="rounded-md border border-slate-300 bg-white px-3 py-2 hover:bg-slate-50">
                やめる
              </button>
            </div>
          </div>
        )}
        {error && <p className="rounded-md bg-rose-50 px-3 py-2 text-rose-800">{error}</p>}
        {flash && <p className="rounded-md bg-emerald-50 px-3 py-2 text-emerald-800">{flash}</p>}
      </section>

      {data.unlicensedDrivers.length > 0 && (
        <section className="rounded-xl border border-rose-200 bg-rose-50/60 p-4 text-sm shadow-sm">
          <h2 className="font-semibold text-rose-900">社用車を運転した人で、運転免許を確かめられない人(この90日)</h2>
          <ul className="mt-2 space-y-1">
            {data.unlicensedDrivers.map((d) => (
              <li key={d.name} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{d.name}</span>
                <span className="text-xs text-rose-800">{d.reason}</span>
                <button onClick={() => setDraft({ holderUserId: users.find((u) => u.name.replace(/\s/g, "") === d.name.replace(/\s/g, ""))?.id ?? null, holderName: d.name, name: "普通自動車免許", number: null, expiresOn: null })} className="ml-auto rounded-md border border-rose-300 bg-white px-2.5 py-1 text-xs text-rose-800 hover:bg-rose-100">
                  運転免許を記録する
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
        <h2 className="font-semibold">記録している資格・免許({data.licenses.length}件)</h2>
        {data.licenses.length ? (
          <ul className="mt-2 divide-y divide-slate-100">
            {data.licenses.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span className="font-medium">{l.holderName}</span>
                <span>{l.name}</span>
                {l.number && <span className="text-xs text-slate-500">番号 {l.number}</span>}
                <span className={`rounded-full px-2 py-0.5 text-xs ${l.state === "EXPIRED" ? "bg-rose-50 text-rose-800 ring-1 ring-rose-200" : l.state === "SOON" ? "bg-amber-50 text-amber-900 ring-1 ring-amber-200" : "bg-slate-100 text-slate-600"}`}>
                  {l.state === "EXPIRED" ? `${ymd(l.expiresOn)}に切れています` : l.state === "SOON" ? `${ymd(l.expiresOn)}まで(あと${l.days}日)` : ymd(l.expiresOn)}
                </span>
                {l.checkedOn && <span className="text-xs text-slate-500">確認 {ymd(l.checkedOn)}</span>}
                <span className="ml-auto flex gap-2">
                  <button onClick={() => setDraft({ id: l.id, holderUserId: l.holderUserId, holderName: l.holderName, name: l.name, number: l.number, expiresOn: l.expiresOn, checkedOn: l.checkedOn })} className="text-xs text-indigo-700 hover:underline">
                    直す(更新)
                  </button>
                  <button onClick={() => remove(l)} disabled={busy === l.id} className="text-xs text-slate-400 hover:text-rose-700">
                    消す
                  </button>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-slate-500">まだ記録はありません。</p>
        )}
      </section>
    </div>
  );
}

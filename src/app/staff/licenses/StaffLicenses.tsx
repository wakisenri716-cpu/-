"use client";

import { useEffect, useState } from "react";

type License = { id: string; name: string; number: string | null; expiresOn: string | null; checkedOn: string | null; state: "OK" | "SOON" | "EXPIRED"; days: number | null };
type Form = { id?: string; name: string; number: string; expiresOn: string };
const ymd = (k: string | null) => (k ? `${Number(k.slice(0, 4))}/${Number(k.slice(5, 7))}/${Number(k.slice(8, 10))}` : "期限なし");
const input = "w-full rounded-xl border border-slate-300 px-3 py-2 text-sm";

export function StaffLicenses() {
  const [list, setList] = useState<License[] | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = () =>
    fetch("/api/staff-app/licenses")
      .then((r) => (r.ok ? r.json() : { licenses: [] }))
      .then((d) => setList(d.licenses ?? []))
      .catch(() => setList([]));
  useEffect(() => {
    load();
  }, []);

  async function save() {
    if (!form) return;
    setBusy(true);
    setError(null);
    const res = await fetch(form.id ? `/api/staff-app/licenses/${form.id}` : "/api/staff-app/licenses", { method: form.id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(json.error || "保存できませんでした");
    setForm(null);
    load();
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">資格・免許</h1>
        <p className="mt-1 text-sm text-slate-600">運転免許などの資格・免許と有効期限を入れておくと、期限の30日前にメールで知らせます。更新したら新しい期限を入れてください(総務が新しい免許証などを確かめます)。</p>
      </div>
      {list === null ? (
        <p className="text-sm text-slate-500">読み込んでいます…</p>
      ) : (
        <ul className="space-y-2">
          {list.map((l) => (
            <li key={l.id} className="space-y-1 rounded-2xl bg-white p-4 text-sm shadow-sm ring-1 ring-slate-200">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{l.name}</span>
                <button onClick={() => setForm({ id: l.id, name: l.name, number: l.number ?? "", expiresOn: l.expiresOn ?? "" })} className="text-xs text-indigo-700">
                  更新した・直す
                </button>
              </div>
              <p className={l.state === "EXPIRED" ? "font-medium text-rose-700" : l.state === "SOON" ? "font-medium text-amber-700" : "text-slate-600"}>
                {l.state === "EXPIRED" ? `${ymd(l.expiresOn)}に切れています` : l.state === "SOON" ? `${ymd(l.expiresOn)}まで(あと${l.days}日)` : `有効期限: ${ymd(l.expiresOn)}`}
              </p>
              <p className="text-xs text-slate-500">{l.checkedOn ? `総務が${ymd(l.checkedOn)}に確かめました` : "総務の確認待ち"}</p>
            </li>
          ))}
          {list.length === 0 && <li className="rounded-2xl bg-white p-4 text-sm text-slate-500 shadow-sm ring-1 ring-slate-200">まだ登録していません。</li>}
        </ul>
      )}
      {form ? (
        <section className="space-y-2 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <input aria-label="資格・免許の名前" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="例: 普通自動車免許" className={input} />
          <input aria-label="番号" value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} placeholder="番号の下4けた(任意)" className={input} />
          <label className="block text-xs text-slate-600">
            有効期限(期限のない資格は空)
            <input aria-label="有効期限" type="date" value={form.expiresOn} onChange={(e) => setForm({ ...form, expiresOn: e.target.value })} className={input} />
          </label>
          {error && <p className="text-sm text-rose-700">{error}</p>}
          <div className="flex gap-2">
            <button onClick={save} disabled={busy || !form.name.trim()} className="flex-1 rounded-xl bg-vermilion-600 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">
              {busy ? "保存しています…" : "保存する"}
            </button>
            <button onClick={() => setForm(null)} className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm">
              やめる
            </button>
          </div>
        </section>
      ) : (
        <button onClick={() => setForm({ name: "", number: "", expiresOn: "" })} className="w-full rounded-xl border border-indigo-200 bg-white px-4 py-2.5 text-sm font-medium text-indigo-700">
          資格・免許を足す
        </button>
      )}
    </div>
  );
}

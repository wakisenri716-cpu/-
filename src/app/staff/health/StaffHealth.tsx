"use client";

import { useEffect, useState } from "react";

type Kind = "REGULAR" | "HIRING" | "STRESS";
type Rec = { id: string; kind: Kind; kindLabel: string; plannedOn: string | null; doneOn: string | null; clinic: string | null; followUp: boolean; followUpDoneOn: string | null };
type Data = { linked: false } | { linked: true; year: number; today: string; state: string; stateLabel: string; lastDone: string | null; records: Rec[] };
type Form = { action: "plan" | "done"; kind: Kind; day: string; clinic: string; followUp: boolean };
const ymd = (k: string | null) => (k ? `${Number(k.slice(0, 4))}/${Number(k.slice(5, 7))}/${Number(k.slice(8, 10))}` : "");
const input = "w-full rounded-xl border border-slate-300 px-3 py-2 text-sm";
const TONE: Record<string, string> = { DONE: "text-emerald-700", PLANNED: "text-sky-700", PASSED: "text-amber-700", NOT_YET: "text-amber-700", DUE: "text-rose-700" };

export function StaffHealth() {
  const [data, setData] = useState<Data | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const load = () =>
    fetch("/api/staff-app/health")
      .then((r) => (r.ok ? r.json() : { linked: false }))
      .then(setData)
      .catch(() => setData({ linked: false }));
  useEffect(() => {
    load();
  }, []);

  async function post(body: Record<string, unknown>, done: string) {
    setBusy(true);
    setError(null);
    setFlash(null);
    const res = await fetch("/api/staff-app/health", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(json.error || "保存できませんでした");
    setForm(null);
    setFlash(done);
    load();
  }
  const save = () => form && post({ action: form.action, kind: form.kind, [form.action === "done" ? "doneOn" : "plannedOn"]: form.day, clinic: form.clinic, followUp: form.followUp }, form.action === "done" ? "受けたことを総務に伝えました" : "予約を総務に伝えました");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">健康診断</h1>
        <p className="mt-1 text-sm text-slate-600">健康診断を予約したら日にちを、受けたらその日を入れてください。総務に伝わります。結果の中身(病名・数値)は入れません。再検査が必要と言われたかどうかだけ教えてください。</p>
      </div>
      {data === null ? (
        <p className="text-sm text-slate-500">読み込んでいます…</p>
      ) : !data.linked ? (
        <p className="rounded-2xl bg-white p-4 text-sm text-slate-600 shadow-sm ring-1 ring-slate-200">あなたのスタッフ登録が見つかりません。総務に、ログインとスタッフのひも付けを頼んでください。</p>
      ) : (
        <>
          <section className="rounded-2xl bg-white p-4 text-sm shadow-sm ring-1 ring-slate-200">
            <p className="text-xs text-slate-500">{data.year}年の健康診断</p>
            <p className={`mt-1 text-lg font-semibold ${TONE[data.state] ?? ""}`}>{data.stateLabel}</p>
            {data.lastDone && <p className="text-xs text-slate-500">前に受けた日: {ymd(data.lastDone)}</p>}
            <div className="mt-3 flex gap-2">
              <button onClick={() => setForm({ action: "plan", kind: "REGULAR", day: "", clinic: "", followUp: false })} className="flex-1 rounded-xl border border-slate-300 px-3 py-2 font-medium">
                予約した
              </button>
              <button onClick={() => setForm({ action: "done", kind: "REGULAR", day: data.today, clinic: "", followUp: false })} className="flex-1 rounded-xl bg-vermilion-600 px-3 py-2 font-medium text-white">
                受けた
              </button>
            </div>
          </section>
          {form && (
            <section className="space-y-2 rounded-2xl bg-white p-4 text-sm shadow-sm ring-1 ring-slate-200">
              <select aria-label="種類" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as Kind })} className={input}>
                <option value="REGULAR">定期健康診断</option>
                <option value="HIRING">雇入時健康診断(入社のとき)</option>
                <option value="STRESS">ストレスチェック</option>
              </select>
              <label className="block text-xs text-slate-600">
                {form.action === "done" ? "受けた日" : "予約した日"}
                <input aria-label={form.action === "done" ? "受けた日" : "予約した日"} type="date" value={form.day} {...(form.action === "done" && data.linked ? { max: data.today } : data.linked ? { min: data.today } : {})} onChange={(e) => setForm({ ...form, day: e.target.value })} className={input} />
              </label>
              <input aria-label="病院" value={form.clinic} onChange={(e) => setForm({ ...form, clinic: e.target.value })} placeholder="病院・健診センター(任意)" className={input} />
              {form.action === "done" && form.kind !== "STRESS" && (
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={form.followUp} onChange={(e) => setForm({ ...form, followUp: e.target.checked })} />
                  再検査・精密検査が必要と言われた
                </label>
              )}
              <div className="flex gap-2">
                <button onClick={save} disabled={busy || !form.day} className="flex-1 rounded-xl bg-vermilion-600 px-3 py-2 font-medium text-white disabled:opacity-50">
                  {busy ? "送っています…" : "総務に伝える"}
                </button>
                <button onClick={() => setForm(null)} className="rounded-xl border border-slate-300 px-3 py-2">
                  やめる
                </button>
              </div>
            </section>
          )}
          {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}
          {flash && <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{flash}</p>}
          <ul className="space-y-2">
            {data.records.map((r) => (
              <li key={r.id} className="space-y-1 rounded-2xl bg-white p-4 text-sm shadow-sm ring-1 ring-slate-200">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{r.kindLabel}</span>
                  <span className="text-xs text-slate-600">{r.doneOn ? `${ymd(r.doneOn)}に受けた` : `予約 ${ymd(r.plannedOn)}`}</span>
                </div>
                {r.clinic && <p className="text-xs text-slate-500">{r.clinic}</p>}
                {r.followUp &&
                  (r.followUpDoneOn ? (
                    <p className="text-xs text-slate-500">再検査: {ymd(r.followUpDoneOn)}に受けた</p>
                  ) : (
                    <div className="flex items-center justify-between gap-2 rounded-xl bg-amber-50 px-3 py-2 text-amber-900">
                      <span className="text-xs">再検査をまだ受けていません</span>
                      <button onClick={() => post({ action: "followUpDone", id: r.id }, "再検査を受けたことを総務に伝えました")} disabled={busy} className="rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-xs">
                        再検査を受けた
                      </button>
                    </div>
                  ))}
              </li>
            ))}
            {data.records.length === 0 && <li className="rounded-2xl bg-white p-4 text-sm text-slate-500 shadow-sm ring-1 ring-slate-200">まだ記録はありません。</li>}
          </ul>
        </>
      )}
    </div>
  );
}

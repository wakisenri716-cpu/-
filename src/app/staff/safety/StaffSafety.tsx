"use client";

import { useEffect, useState } from "react";

type Check = { id: string; title: string; message: string; createdAt: string; mine: { status: string; canWork: string; note: string | null } | null };
const STATUS = [
  { v: "SAFE", label: "無事です", cls: "border-emerald-300 bg-emerald-50 text-emerald-900" },
  { v: "INJURED", label: "けがをした", cls: "border-amber-300 bg-amber-50 text-amber-900" },
  { v: "HELP", label: "助けが必要", cls: "border-rose-300 bg-rose-50 text-rose-900" },
];
const WORK = [
  { v: "YES", label: "出社できる" },
  { v: "LATER", label: "遅れて出社" },
  { v: "REMOTE", label: "家で仕事できる" },
  { v: "NO", label: "出社できない" },
];

export function StaffSafety() {
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [form, setForm] = useState<Record<string, { status: string; canWork: string; note: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = () =>
    fetch("/api/staff-app/safety")
      .then((r) => (r.ok ? r.json() : { checks: [] }))
      .then((d) => {
        setChecks(d.checks ?? []);
        setForm(Object.fromEntries((d.checks ?? []).map((c: Check) => [c.id, { status: c.mine?.status ?? "", canWork: c.mine?.canWork ?? "", note: c.mine?.note ?? "" }])));
      })
      .catch(() => setChecks([]));
  useEffect(() => {
    load();
  }, []);

  async function send(id: string) {
    setBusy(id);
    setMsg(null);
    const res = await fetch("/api/staff-app/safety", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ checkId: id, ...form[id] }) });
    const json = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return setMsg({ ok: false, text: json.error || "送れませんでした" });
    setMsg({ ok: true, text: "会社に伝えました。直したいときは、もう一度選んで送ってください" });
    load();
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">安否確認</h1>
        <p className="mt-1 text-sm text-slate-600">まず自分と家族の身の安全を守ってください。落ち着いたら、ボタンを選んで会社に伝えます。</p>
      </div>
      {checks === null ? (
        <p className="text-sm text-slate-500">読み込んでいます…</p>
      ) : checks.length === 0 ? (
        <p className="rounded-2xl bg-white p-4 text-sm text-slate-500 shadow-sm ring-1 ring-slate-200">いま答える安否確認はありません。</p>
      ) : (
        checks.map((c) => {
          const f = form[c.id] ?? { status: "", canWork: "", note: "" };
          const set = (patch: Partial<typeof f>) => setForm({ ...form, [c.id]: { ...f, ...patch } });
          return (
            <section key={c.id} className="space-y-3 rounded-2xl bg-white p-4 text-sm shadow-sm ring-1 ring-slate-200">
              <div>
                <h2 className="font-semibold">{c.title}</h2>
                <p className="mt-1 whitespace-pre-line text-slate-600">{c.message}</p>
              </div>
              {c.mine && <p className="rounded-xl bg-emerald-50 px-3 py-2 text-emerald-800">答えました。変わったら選び直して送ってください。</p>}
              <div>
                <p className="mb-1 text-xs text-slate-500">いまの様子</p>
                <div className="grid grid-cols-3 gap-2">
                  {STATUS.map((s) => (
                    <button key={s.v} onClick={() => set({ status: s.v })} aria-pressed={f.status === s.v} className={`rounded-xl border px-2 py-3 font-medium ${f.status === s.v ? s.cls + " ring-2 ring-offset-1" : "border-slate-300 bg-white"}`}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-1 text-xs text-slate-500">出社</p>
                <div className="grid grid-cols-2 gap-2">
                  {WORK.map((w) => (
                    <button key={w.v} onClick={() => set({ canWork: w.v })} aria-pressed={f.canWork === w.v} className={`rounded-xl border px-2 py-2.5 ${f.canWork === w.v ? "border-indigo-400 bg-indigo-50 font-medium text-indigo-900 ring-2 ring-indigo-300" : "border-slate-300 bg-white"}`}>
                      {w.label}
                    </button>
                  ))}
                </div>
              </div>
              <textarea aria-label="ひとこと" value={f.note} onChange={(e) => set({ note: e.target.value })} rows={2} placeholder="ひとこと(任意) 例: 電車が止まっています" className="w-full rounded-xl border border-slate-300 px-3 py-2" />
              <button onClick={() => send(c.id)} disabled={busy === c.id || !f.status || !f.canWork} className="w-full rounded-xl bg-vermilion-600 px-3 py-3 font-semibold text-white disabled:opacity-50">
                {busy === c.id ? "送っています…" : "会社に伝える"}
              </button>
            </section>
          );
        })
      )}
      {msg && <p className={`rounded-xl px-3 py-2 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}>{msg.text}</p>}
    </div>
  );
}

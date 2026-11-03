"use client";

import { useEffect, useState } from "react";

type Seal = "JITSUIN" | "BANK" | "KAKUIN" | "OTHER";
type Row = { id: string; seal: Seal; document: string; party: string | null; copies: number; status: string; reply: string | null; doneOn: string | null; createdAt: string };
type Draft = { seal: Seal; document: string; party: string | null; copies: number; purpose: string | null };
const SEALS: Record<Seal, string> = { JITSUIN: "実印(代表者印)", BANK: "銀行印", KAKUIN: "角印(社印)", OTHER: "そのほかの印" };
const STATUS: Record<string, string> = { REQUESTED: "申請中", APPROVED: "認められました(押す前)", REJECTED: "見送り", DONE: "押しました" };
const input = "w-full rounded-xl border border-slate-300 px-3 py-2 text-sm";

export function StaffSeals() {
  const [list, setList] = useState<Row[] | null>(null);
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = () =>
    fetch("/api/staff-app/seals")
      .then((r) => (r.ok ? r.json() : { seals: [] }))
      .then((d) => setList(d.seals ?? []))
      .catch(() => setList([]));
  useEffect(() => {
    load();
  }, []);
  async function post(body: unknown) {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/staff-app/seals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setMsg({ ok: false, text: json.error || "うまくいきませんでした" });
      return null;
    }
    return json;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">押印の申請</h1>
        <p className="mt-1 text-sm text-slate-600">会社の印を押してほしい書類を1行で書いてください。管理者が認めて押すと、メールで知らせます。</p>
      </div>
      <section className="space-y-2 rounded-2xl bg-white p-4 text-sm shadow-sm ring-1 ring-slate-200">
        <textarea aria-label="押したい書類" value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="例: さくら商事との業務委託契約書 2部 実印" className={input} />
        <button
          onClick={async () => {
            const r = await post({ action: "parse", text });
            if (r) setDraft(r.draft);
          }}
          disabled={busy || !text.trim()}
          className="w-full rounded-xl border border-slate-300 px-3 py-2 font-medium disabled:opacity-50"
        >
          読み取る
        </button>
        {draft && (
          <div className="space-y-2 rounded-xl bg-slate-50 p-3">
            <select aria-label="印" value={draft.seal} onChange={(e) => setDraft({ ...draft, seal: e.target.value as Seal })} className={input}>
              {(Object.keys(SEALS) as Seal[]).map((s) => (
                <option key={s} value={s}>
                  {SEALS[s]}
                </option>
              ))}
            </select>
            <input aria-label="書類" value={draft.document} onChange={(e) => setDraft({ ...draft, document: e.target.value })} className={input} />
            <div className="flex gap-2">
              <input aria-label="相手先" value={draft.party ?? ""} placeholder="相手先" onChange={(e) => setDraft({ ...draft, party: e.target.value || null })} className={input} />
              <input aria-label="部数" inputMode="numeric" value={draft.copies} onChange={(e) => setDraft({ ...draft, copies: Number(e.target.value.replace(/[^\d]/g, "")) || 1 })} className="w-20 rounded-xl border border-slate-300 px-3 py-2 text-sm" />
            </div>
            <input aria-label="使いみち" value={draft.purpose ?? ""} placeholder="使いみち(任意)" onChange={(e) => setDraft({ ...draft, purpose: e.target.value || null })} className={input} />
            <button
              onClick={async () => {
                if (await post(draft)) {
                  setDraft(null);
                  setText("");
                  setMsg({ ok: true, text: "申請しました" });
                  load();
                }
              }}
              disabled={busy}
              className="w-full rounded-xl bg-vermilion-600 px-3 py-2.5 font-semibold text-white disabled:opacity-50"
            >
              申請する
            </button>
          </div>
        )}
      </section>
      {msg && <p className={`rounded-xl px-3 py-2 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}>{msg.text}</p>}
      <ul className="space-y-2">
        {(list ?? []).map((r) => (
          <li key={r.id} className="space-y-0.5 rounded-2xl bg-white p-4 text-sm shadow-sm ring-1 ring-slate-200">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">{r.document}</span>
              <span className={`text-xs ${r.status === "DONE" ? "text-emerald-700" : r.status === "REJECTED" ? "text-rose-700" : "text-amber-700"}`}>{STATUS[r.status] ?? r.status}</span>
            </div>
            <p className="text-xs text-slate-500">
              {SEALS[r.seal]}・{r.copies}部{r.party ? `・${r.party}` : ""}
              {r.reply ? `・理由: ${r.reply}` : ""}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

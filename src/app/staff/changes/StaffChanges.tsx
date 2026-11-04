"use client";

import { useEffect, useState } from "react";

type Kind = "ADDRESS" | "PHONE" | "NAME" | "EMERGENCY";
type Values = { address?: string | null; phone?: string | null; name?: string | null; kana?: string | null; emergencyName?: string | null; emergencyPhone?: string | null; emergencyRelation?: string | null };
type Draft = { kind: Kind; values: Values; effectiveOn: string | null };
type Row = { id: string; kind: Kind; status: string; reply: string | null; createdAt: string };
const KINDS: Record<Kind, string> = { ADDRESS: "住所", PHONE: "電話番号", NAME: "名前", EMERGENCY: "緊急連絡先" };
const STATUS: Record<string, string> = { REQUESTED: "総務の確認待ち", APPLIED: "名簿に入りました", REJECTED: "確かめが必要" };
const input = "w-full rounded-xl border border-slate-300 px-3 py-2 text-sm";

export function StaffChanges({ initialText = "" }: { initialText?: string }) {
  const [text, setText] = useState(initialText);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = () =>
    fetch("/api/staff-app/notices-change")
      .then((r) => (r.ok ? r.json() : { notices: [] }))
      .then((d) => setRows(d.notices ?? []))
      .catch(() => {});
  useEffect(() => {
    load();
  }, []);
  async function post(body: unknown) {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/staff-app/notices-change", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setMsg({ ok: false, text: json.error || "うまくいきませんでした" });
      return null;
    }
    return json;
  }
  const v = (k: keyof Values, label: string, placeholder = "") =>
    draft && (
      <label className="block text-xs text-slate-600">
        {label}
        <input aria-label={label} value={draft.values[k] ?? ""} placeholder={placeholder} onChange={(e) => setDraft({ ...draft, values: { ...draft.values, [k]: e.target.value || null } })} className={input} />
      </label>
    );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">身上の変更の届け出</h1>
        <p className="mt-1 text-sm text-slate-600">引っ越し・電話番号・名前・緊急連絡先が変わったら届けてください。総務が確かめて名簿に入れます。給与の振込先の口座の変更は、総務に直接伝えてください。</p>
      </div>
      <section className="space-y-2 rounded-2xl bg-white p-4 text-sm shadow-sm ring-1 ring-slate-200">
        <textarea aria-label="変わったこと" value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="例: 11/1に引っ越しました 〒123-4567 東京都千代田区…" className={input} />
        <div className="flex gap-2">
          <button
            onClick={async () => {
              const r = await post({ action: "parse", text });
              if (r) setDraft(r.draft);
            }}
            disabled={busy || !text.trim()}
            className="flex-1 rounded-xl border border-slate-300 px-3 py-2 font-medium disabled:opacity-50"
          >
            読み取る
          </button>
          <select aria-label="種類から選ぶ" value="" onChange={(e) => e.target.value && setDraft({ kind: e.target.value as Kind, values: {}, effectiveOn: null })} className="rounded-xl border border-slate-300 px-2 text-sm">
            <option value="">種類から選ぶ</option>
            {(Object.keys(KINDS) as Kind[]).map((k) => (
              <option key={k} value={k}>
                {KINDS[k]}
              </option>
            ))}
          </select>
        </div>
        {draft && (
          <div className="space-y-2 rounded-xl bg-slate-50 p-3">
            <p className="text-xs font-medium text-slate-700">{KINDS[draft.kind]}の変更</p>
            {draft.kind === "ADDRESS" && (
              <>
                {v("address", "新しい住所", "〒123-4567 東京都…")}
                {v("phone", "電話番号(変わったとき)")}
              </>
            )}
            {draft.kind === "PHONE" && v("phone", "新しい電話番号", "090-1234-5678")}
            {draft.kind === "NAME" && (
              <>
                {v("name", "新しい名前")}
                {v("kana", "ふりがな")}
              </>
            )}
            {draft.kind === "EMERGENCY" && (
              <>
                {v("emergencyName", "緊急連絡先の名前")}
                {v("emergencyRelation", "続きがら", "母")}
                {v("emergencyPhone", "電話番号")}
              </>
            )}
            <label className="block text-xs text-slate-600">
              変わった日
              <input aria-label="変わった日" type="date" value={draft.effectiveOn ?? ""} onChange={(e) => setDraft({ ...draft, effectiveOn: e.target.value || null })} className={input} />
            </label>
            <button
              onClick={async () => {
                if (await post(draft)) {
                  setDraft(null);
                  setText("");
                  setMsg({ ok: true, text: "届け出ました。総務が確かめて名簿に入れます" });
                  load();
                }
              }}
              disabled={busy}
              className="w-full rounded-xl bg-vermilion-600 px-3 py-2.5 font-semibold text-white disabled:opacity-50"
            >
              届け出る
            </button>
          </div>
        )}
      </section>
      {msg && <p className={`rounded-xl px-3 py-2 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}>{msg.text}</p>}
      {rows.length > 0 && (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.id} className="rounded-2xl bg-white p-3 text-sm shadow-sm ring-1 ring-slate-200">
              <span className="font-medium">{KINDS[r.kind]}</span>
              <span className="ml-2 text-xs text-slate-500">{new Date(r.createdAt).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" })}</span>
              <span className={`ml-2 text-xs ${r.status === "APPLIED" ? "text-emerald-700" : r.status === "REJECTED" ? "text-rose-700" : "text-amber-700"}`}>{STATUS[r.status] ?? r.status}</span>
              {r.reply && <p className="mt-1 text-xs text-slate-600">{r.reply}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

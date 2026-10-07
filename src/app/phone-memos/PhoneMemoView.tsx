"use client";

import { useState } from "react";
import Link from "next/link";
import { MEMO_ACTIONS, MEMO_KINDS, type MemoAction, type MemoKind } from "@/lib/phoneMemoLabels";
import type { MemoFields } from "@/lib/phoneMemos";

type Memo = {
  id: string;
  kind: MemoKind;
  callerCompany: string | null;
  callerName: string | null;
  callerPhone: string | null;
  partyKind: string | null;
  forUserId: string | null;
  forName: string | null;
  message: string;
  action: MemoAction;
  urgent: boolean;
  takenByName: string;
  status: "OPEN" | "DONE";
  doneAt: string | null;
  doneNote: string | null;
  createdAt: string;
};

const EMPTY: MemoFields = { kind: "CALL", callerCompany: null, callerName: null, callerPhone: null, partyKind: null, partyId: null, forUserId: null, message: "", action: "CALLBACK", urgent: false };
const when = (iso: string) => {
  const d = new Date(new Date(iso).getTime() + 9 * 3_600_000).toISOString();
  return `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))} ${d.slice(11, 16)}`;
};

export default function PhoneMemoView({ initial, users, parties, viewerId, ai }: { initial: Memo[]; users: { id: string; name: string; email: boolean }[]; parties: { kind: string; id: string; name: string }[]; viewerId: string; ai: boolean }) {
  const [memos, setMemos] = useState(initial);
  const [text, setText] = useState("");
  const [fields, setFields] = useState<MemoFields | null>(null);
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [filter, setFilter] = useState<"mine" | "open" | "done">("open");

  async function call(url: string, init: RequestInit) {
    const res = await fetch(url, { headers: { "content-type": "application/json" }, ...init });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "うまくいきませんでした");
    return data;
  }

  async function parse(useAi: boolean) {
    setBusy(useAi ? "ai" : "parse");
    setError(null);
    try {
      const data = await call("/api/phone-memos/parse", { method: "POST", body: JSON.stringify({ text, useAi }) });
      setFields(data.fields);
    } catch (e) {
      setError(e instanceof Error ? e.message : "うまくいきませんでした");
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (!fields) return;
    setBusy("save");
    setError(null);
    try {
      const data = await call("/api/phone-memos", { method: "POST", body: JSON.stringify({ ...fields, notify }) });
      const list = await call("/api/phone-memos", { method: "GET" });
      setMemos(list.memos);
      setFlash(`伝言を残しました${data.mailed ? "(メールでも知らせました)" : ""}`);
      setFields(null);
      setText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "うまくいきませんでした");
    } finally {
      setBusy(null);
    }
  }

  async function setStatus(m: Memo, status: "OPEN" | "DONE") {
    const doneNote = status === "DONE" ? (window.prompt("対応したこと(任意)", m.action === "CALLBACK" ? "折り返し済み" : "") ?? null) : null;
    if (status === "DONE" && doneNote === null) return;
    setBusy(m.id);
    try {
      const data = await call(`/api/phone-memos/${m.id}`, { method: "PATCH", body: JSON.stringify({ status, doneNote }) });
      setMemos((prev) => prev.map((x) => (x.id === m.id ? data.memo : x)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "うまくいきませんでした");
    } finally {
      setBusy(null);
    }
  }

  async function remove(m: Memo) {
    if (!window.confirm("この伝言メモを消しますか?")) return;
    setBusy(m.id);
    try {
      await call(`/api/phone-memos/${m.id}`, { method: "DELETE" });
      setMemos((prev) => prev.filter((x) => x.id !== m.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "うまくいきませんでした");
    } finally {
      setBusy(null);
    }
  }

  const input = "mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm";
  const set = (patch: Partial<MemoFields>) => setFields((f) => (f ? { ...f, ...patch } : f));
  const party = fields?.partyId ? parties.find((p) => p.id === fields.partyId) : null;
  const forUser = fields?.forUserId ? users.find((u) => u.id === fields.forUserId) : null;
  const shown = memos.filter((m) => (filter === "done" ? m.status === "DONE" : m.status === "OPEN" && (filter === "open" || m.forUserId === viewerId || m.forUserId === null)));
  const openCount = memos.filter((m) => m.status === "OPEN").length;
  const mineCount = memos.filter((m) => m.status === "OPEN" && (m.forUserId === viewerId || m.forUserId === null)).length;

  return (
    <div className="space-y-6">
      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <label className="block text-sm">
          <span className="text-slate-700">伝言(走り書きでかまいません)</span>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="例: さくら商事の山田さんから田中さんへ。見積の件で折り返しほしい。03-1234-5678 急ぎ" className={input} />
        </label>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => parse(false)} disabled={!!busy || !text.trim()} className="rounded-md bg-vermilion-600 px-4 py-2 text-sm font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
            {busy === "parse" ? "分けています…" : "項目に分ける"}
          </button>
          {ai && (
            <button onClick={() => parse(true)} disabled={!!busy || !text.trim()} className="rounded-md border border-indigo-300 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50">
              {busy === "ai" ? "AIが整理しています…" : "AIで整理"}
            </button>
          )}
          {!fields && (
            <button onClick={() => setFields({ ...EMPTY, message: text.trim() })} disabled={!!busy} className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-50">
              自分で入れる
            </button>
          )}
        </div>
        {fields && (
          <div className="space-y-4 border-t border-slate-100 pt-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <fieldset className="text-sm">
                <legend className="text-slate-700">種類</legend>
                <div className="mt-2 flex gap-4">
                  {(Object.keys(MEMO_KINDS) as MemoKind[]).map((k) => (
                    <label key={k} className="flex items-center gap-1.5">
                      <input type="radio" checked={fields.kind === k} onChange={() => set({ kind: k })} />
                      {MEMO_KINDS[k]}
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="block text-sm">
                <span className="text-slate-700">宛先</span>
                <select value={fields.forUserId ?? ""} onChange={(e) => set({ forUserId: e.target.value || null })} className={input}>
                  <option value="">どなたか(全員のやることに出ます)</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="text-slate-700">相手の会社</span>
                <input value={fields.callerCompany ?? ""} onChange={(e) => set({ callerCompany: e.target.value || null, partyId: null, partyKind: null })} className={input} />
                {party && <span className="mt-1 block text-xs text-emerald-700">住所録の{party.kind === "customer" ? "顧客" : "仕入先"}「{party.name}」</span>}
              </label>
              <label className="block text-sm">
                <span className="text-slate-700">相手の名前</span>
                <input value={fields.callerName ?? ""} onChange={(e) => set({ callerName: e.target.value || null })} className={input} />
              </label>
              <label className="block text-sm">
                <span className="text-slate-700">電話番号</span>
                <input value={fields.callerPhone ?? ""} onChange={(e) => set({ callerPhone: e.target.value || null })} inputMode="tel" className={input} />
              </label>
              <label className="block text-sm">
                <span className="text-slate-700">どうしてほしいか</span>
                <select value={fields.action} onChange={(e) => set({ action: e.target.value as MemoAction })} className={input}>
                  {(Object.keys(MEMO_ACTIONS) as MemoAction[]).map((a) => (
                    <option key={a} value={a}>
                      {MEMO_ACTIONS[a]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm sm:col-span-2">
                <span className="text-slate-700">用件</span>
                <textarea value={fields.message} onChange={(e) => set({ message: e.target.value })} rows={2} className={input} />
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={fields.urgent} onChange={(e) => set({ urgent: e.target.checked })} />
                至急
              </label>
              {forUser && forUser.id !== viewerId && (
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={notify && forUser.email} disabled={!forUser.email} onChange={(e) => setNotify(e.target.checked)} />
                  {forUser.email ? `${forUser.name}さんにメールでも知らせる` : `${forUser.name}さんはメールアドレスがありません`}
                </label>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={save} disabled={!!busy || !fields.message.trim()} className="rounded-md bg-vermilion-600 px-4 py-2 text-sm font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
                {busy === "save" ? "残しています…" : "伝言を残す"}
              </button>
              <button onClick={() => setFields(null)} className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50">
                やめる
              </button>
            </div>
          </div>
        )}
        {error && <p className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-800">{error}</p>}
        {flash && !fields && <p className="rounded-md bg-emerald-50 px-4 py-2 text-sm text-emerald-800">{flash}</p>}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap gap-2" role="tablist">
          {(
            [
              ["mine", `自分あて ${mineCount}`],
              ["open", `未対応 ${openCount}`],
              ["done", "対応済み(30日)"],
            ] as const
          ).map(([k, label]) => (
            <button key={k} role="tab" aria-selected={filter === k} onClick={() => setFilter(k)} className={`rounded-full border px-3 py-1.5 text-sm ${filter === k ? "border-indigo-700 bg-indigo-700 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}>
              {label}
            </button>
          ))}
        </div>
        {shown.length === 0 && <p className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-500">{filter === "done" ? "対応済みの伝言はありません" : "未対応の伝言はありません"}</p>}
        {shown.map((m) => (
          <article key={m.id} className={`space-y-2 rounded-xl border bg-white p-4 shadow-sm ${m.urgent && m.status === "OPEN" ? "border-rose-200" : "border-slate-200"} ${m.status === "DONE" ? "opacity-70" : ""}`}>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              {m.urgent && m.status === "OPEN" && <span className="rounded bg-rose-600 px-1.5 py-0.5 text-xs font-medium text-white">至急</span>}
              <span className="font-semibold">
                {[m.callerCompany, m.callerName ? `${m.callerName}様` : null].filter(Boolean).join(" ") || "お名前なし"}
              </span>
              <span className="text-xs text-slate-500">
                {MEMO_KINDS[m.kind]} {when(m.createdAt)} ・ 受けた人 {m.takenByName}
              </span>
              <span className="ml-auto text-xs text-slate-600">{m.forName ? `${m.forName}さんへ` : "どなたか"}</span>
            </div>
            <p className="whitespace-pre-wrap text-sm text-slate-800">{m.message}</p>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className={`rounded-full px-2.5 py-0.5 text-xs ${m.action === "CALLBACK" ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-700"}`}>{MEMO_ACTIONS[m.action]}</span>
              {m.callerPhone && (
                <a href={`tel:${m.callerPhone.replace(/[^\d+]/g, "")}`} className="tabular-nums text-indigo-700 underline">
                  {m.callerPhone}
                </a>
              )}
              {m.partyKind && (
                <Link href="/vendors" className="text-xs text-slate-500 underline">
                  住所録
                </Link>
              )}
              <span className="ml-auto flex gap-2">
                {m.status === "OPEN" ? (
                  <button onClick={() => setStatus(m, "DONE")} disabled={busy === m.id} className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                    対応済みにする
                  </button>
                ) : (
                  <button onClick={() => setStatus(m, "OPEN")} disabled={busy === m.id} className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs hover:bg-slate-50 disabled:opacity-50">
                    未対応に戻す
                  </button>
                )}
                <button onClick={() => remove(m)} disabled={busy === m.id} className="text-xs text-slate-500 hover:text-rose-700">
                  消す
                </button>
              </span>
            </div>
            {m.status === "DONE" && (
              <p className="text-xs text-emerald-700">
                対応済み {m.doneAt ? when(m.doneAt) : ""}
                {m.doneNote ? `: ${m.doneNote}` : ""}
              </p>
            )}
          </article>
        ))}
      </section>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";

type Item = { id: string; item: string; place: string | null; foundOn: string; keptAt: string | null; status: "FOUND" | "CLAIMED" | "RETURNED" | "DISPOSED"; foundByName: string; claimedByName: string | null; overdue: boolean };
type Draft = { item: string; place: string | null; keptAt: string | null; foundOn: string };
const STATUS = { FOUND: "あずかり中", CLAIMED: "持ち主が名のった", RETURNED: "返した", DISPOSED: "処分した" };
const md = (k: string) => `${Number(k.slice(5, 7))}/${Number(k.slice(8, 10))}`;

export function LostView({ admin = false }: { admin?: boolean }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<{ items: Item[]; mode: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = () =>
    fetch("/api/staff-app/lost")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => setItems(d.items ?? []))
      .catch(() => setItems([]));
  useEffect(() => {
    load();
  }, []);
  async function call(key: string, url: string, method: string, body?: unknown) {
    setBusy(key);
    setMsg(null);
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) {
      setMsg({ ok: false, text: json.error || "うまくいきませんでした" });
      return null;
    }
    return json;
  }
  const card = "space-y-2 rounded-2xl bg-white p-4 text-sm shadow-sm ring-1 ring-slate-200";
  const input = "w-full rounded-xl border border-slate-300 px-3 py-2 text-sm";
  const row = (i: Item) => (
    <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
      <span className="font-medium">{i.item}</span>
      <span className="text-xs text-slate-500">
        {md(i.foundOn)}
        {i.place ? `・${i.place}` : ""}
        {i.keptAt ? `・${i.keptAt}であずかり中` : ""}
      </span>
      <span className={`rounded-full px-2 py-0.5 text-xs ${i.overdue ? "bg-rose-50 text-rose-800 ring-1 ring-rose-200" : i.status === "CLAIMED" ? "bg-amber-50 text-amber-900 ring-1 ring-amber-200" : "bg-slate-100 text-slate-600"}`}>
        {i.overdue ? "30日すぎた" : STATUS[i.status]}
        {i.claimedByName ? `(${i.claimedByName})` : ""}
      </span>
      <span className="ml-auto flex gap-2">
        {i.status === "FOUND" && (
          <button
            onClick={async () => {
              if (await call(i.id, `/api/staff-app/lost/${i.id}`, "POST")) {
                setMsg({ ok: true, text: "総務に知らせました。受け取りに行ってください" });
                setHits(null);
                load();
              }
            }}
            disabled={!!busy}
            className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs"
          >
            わたしのです
          </button>
        )}
        {admin &&
          (i.status === "FOUND" || i.status === "CLAIMED") &&
          (["RETURNED", "DISPOSED"] as const).map((s) => (
            <button
              key={s}
              onClick={async () => {
                if (s === "DISPOSED" && !confirm(`${i.item}を処分したことにしますか?`)) return;
                if (await call(`${i.id}-${s}`, `/api/lost-items/${i.id}`, "PATCH", { status: s })) load();
              }}
              disabled={!!busy}
              className={`text-xs ${s === "RETURNED" ? "text-indigo-700" : "text-slate-400 hover:text-rose-700"}`}
            >
              {s === "RETURNED" ? "返した" : "処分した"}
            </button>
          ))}
      </span>
    </li>
  );

  return (
    <div className="space-y-4">
      <section className={card}>
        <h2 className="font-semibold">なくしたものを探す</h2>
        <div className="flex gap-2">
          <input aria-label="なくしたもの" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="例: 黒い傘" className={input} />
          <button
            onClick={async () => {
              const r = await call("search", "/api/staff-app/lost", "POST", { action: "search", query, useAi: true });
              if (r) setHits(r);
            }}
            disabled={!!busy || !query.trim()}
            className="shrink-0 rounded-xl bg-vermilion-600 px-4 py-2 font-medium text-white disabled:opacity-50"
          >
            {busy === "search" ? "探しています…" : "探す"}
          </button>
        </div>
        {hits && (hits.items.length ? <ul className="divide-y divide-slate-100">{hits.items.map(row)}</ul> : <p className="text-slate-500">合いそうな落とし物はありません。見つかったら、この一覧に出ます。</p>)}
        {hits?.mode === "claude" && <p className="text-xs text-indigo-700">AIが言いかえも見て並べました</p>}
      </section>
      <section className={card}>
        <h2 className="font-semibold">見つけたものを届ける</h2>
        <textarea aria-label="見つけたもの" value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="例: 会議室Aに黒い折りたたみ傘 総務であずかり中" className={input} />
        <button
          onClick={async () => {
            const r = await call("parse", "/api/staff-app/lost", "POST", { action: "parse", text });
            if (r) setDraft(r.draft);
          }}
          disabled={!!busy || !text.trim()}
          className="w-full rounded-xl border border-slate-300 px-3 py-2 font-medium disabled:opacity-50"
        >
          読み取る
        </button>
        {draft && (
          <div className="space-y-2 rounded-xl bg-slate-50 p-3">
            <input aria-label="品物" value={draft.item} onChange={(e) => setDraft({ ...draft, item: e.target.value })} placeholder="品物(色や特徴も)" className={input} />
            <div className="flex gap-2">
              <input aria-label="見つけた場所" value={draft.place ?? ""} onChange={(e) => setDraft({ ...draft, place: e.target.value || null })} placeholder="見つけた場所" className={input} />
              <input aria-label="あずかっている場所" value={draft.keptAt ?? ""} onChange={(e) => setDraft({ ...draft, keptAt: e.target.value || null })} placeholder="あずかっている場所" className={input} />
            </div>
            <button
              onClick={async () => {
                if (await call("save", "/api/staff-app/lost", "POST", draft)) {
                  setDraft(null);
                  setText("");
                  setMsg({ ok: true, text: "届けました。持ち主が名のると総務に知らせます" });
                  load();
                }
              }}
              disabled={!!busy}
              className="w-full rounded-xl bg-vermilion-600 px-3 py-2.5 font-semibold text-white disabled:opacity-50"
            >
              届ける
            </button>
          </div>
        )}
      </section>
      {msg && <p className={`rounded-xl px-3 py-2 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}>{msg.text}</p>}
      <section className={card}>
        <h2 className="font-semibold">落とし物の一覧</h2>
        {items === null ? <p className="text-slate-500">読み込んでいます…</p> : items.length ? <ul className="divide-y divide-slate-100">{items.map(row)}</ul> : <p className="text-slate-500">いまあずかっている落とし物はありません。</p>}
      </section>
    </div>
  );
}

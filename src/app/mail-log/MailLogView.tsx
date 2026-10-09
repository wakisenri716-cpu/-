"use client";

import Link from "next/link";
import { useState } from "react";
import { IMPORTANT_KINDS, MAIL_KINDS, type MailKind } from "@/lib/mailItemLabels";

type User = { id: string; name: string; email: boolean };
type Draft = { kind: MailKind; sender: string | null; partyKind: string | null; partyId: string | null; forUserId: string | null; note: string };
type Item = {
  id: string;
  receivedOn: string;
  kind: string;
  sender: string | null;
  forUserId: string | null;
  forName: string | null;
  note: string | null;
  status: string;
  handedAt: string | null;
  handedTo: string | null;
  takenByName: string;
};

const input = "w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm";
const md = (k: string) => `${Number(k.slice(5, 7))}/${Number(k.slice(8, 10))}`;
const kindLabel = (k: string) => MAIL_KINDS[k as MailKind] ?? "郵便物";
const important = (k: string) => (IMPORTANT_KINDS as string[]).includes(k);
const waitDays = (from: string, to: string) => Math.max(0, Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000));

export default function MailLogView({ initial, users, viewerId, today, ai }: { initial: Item[]; users: User[]; viewerId: string; today: string; ai: boolean }) {
  const [items, setItems] = useState(initial);
  const [text, setText] = useState("");
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [mode, setMode] = useState<"claude" | "template" | null>(null);
  const [receivedOn, setReceivedOn] = useState(today);
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  async function call(url: string, method: string, body?: unknown) {
    const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "うまくいきませんでした");
    return data;
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
  const reload = async () => setItems((await call("/api/mail-log", "GET")).items);

  const parse = (useAi: boolean) =>
    run(useAi ? "ai" : "parse", async () => {
      const data = await call("/api/mail-log/parse", "POST", { text, useAi });
      setDrafts(data.items);
      setMode(data.mode);
    });
  const save = () =>
    run("save", async () => {
      const data = await call("/api/mail-log", "POST", { items: drafts, receivedOn, notify });
      setDrafts(null);
      setText("");
      setFlash(`${data.count}件を記録しました${data.mailed ? `(${data.mailed}人にメールで知らせました)` : ""}`);
      await reload();
    });
  const setDraft = (i: number, patch: Partial<Draft>) => setDrafts((d) => (d ? d.map((x, j) => (j === i ? { ...x, ...patch } : x)) : d));
  const hand = (id: string, status: "HANDED" | "WAITING") =>
    run(id, async () => {
      await call(`/api/mail-log/${id}`, "PATCH", { status });
      await reload();
    });
  const remove = (id: string) =>
    run(id, async () => {
      await call(`/api/mail-log/${id}`, "DELETE");
      await reload();
    });

  const waiting = items.filter((m) => m.status === "WAITING");
  const handed = items.filter((m) => m.status !== "WAITING");
  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm sm:p-6">
        <label className="block">
          <span className="text-slate-700">届いたもの(1行に1つ)</span>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder={"例: さくら商事から請求書 田中さん宛\n税務署から封書\nアスクルの荷物 2箱"} className={`mt-1 ${input}`} />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => parse(false)} disabled={!!busy || !text.trim()} className="rounded-md bg-vermilion-600 px-4 py-2 font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
            {busy === "parse" ? "分けています…" : "分ける"}
          </button>
          {ai && (
            <button onClick={() => parse(true)} disabled={!!busy || !text.trim()} className="rounded-md border border-indigo-300 bg-indigo-50 px-4 py-2 font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50">
              {busy === "ai" ? "AIが分けています…" : "AIで分ける"}
            </button>
          )}
        </div>
        {drafts && (
          <div className="space-y-3 border-t border-slate-100 pt-3">
            <p className="text-xs text-slate-500">{mode === "claude" ? "AIが分けました。" : "決まったルールで分けました。"}確かめて直してから記録してください。</p>
            <ul className="space-y-2">
              {drafts.map((d, i) => (
                <li key={i} className="grid gap-2 rounded-md border border-slate-200 p-2 sm:grid-cols-[8rem_1fr_10rem_1.5fr_auto] sm:items-center">
                  <select aria-label="種類" value={d.kind} onChange={(e) => setDraft(i, { kind: e.target.value as MailKind })} className={input}>
                    {(Object.keys(MAIL_KINDS) as MailKind[]).map((k) => (
                      <option key={k} value={k}>
                        {MAIL_KINDS[k]}
                      </option>
                    ))}
                  </select>
                  <input aria-label="差出人" value={d.sender ?? ""} onChange={(e) => setDraft(i, { sender: e.target.value, partyKind: null, partyId: null })} placeholder="差出人" className={input} />
                  <select aria-label="宛先" value={d.forUserId ?? ""} onChange={(e) => setDraft(i, { forUserId: e.target.value || null })} className={input}>
                    <option value="">会社あて・どなたか</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                  <input aria-label="メモ" value={d.note} onChange={(e) => setDraft(i, { note: e.target.value })} placeholder="メモ" className={input} />
                  <button onClick={() => setDrafts((x) => (x ? x.filter((_, j) => j !== i) : x))} className="text-xs text-slate-500 hover:text-rose-700">
                    外す
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2">
                <span className="text-slate-600">届いた日</span>
                <input type="date" value={receivedOn} onChange={(e) => e.target.value && setReceivedOn(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1" />
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
                <span>宛先の人にメールで知らせる</span>
              </label>
              <button onClick={save} disabled={!!busy || !drafts.length} className="rounded-md bg-vermilion-600 px-4 py-2 font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
                {busy === "save" ? "記録しています…" : `${drafts.length}件を記録する`}
              </button>
            </div>
          </div>
        )}
        {error && <p className="rounded-md bg-rose-50 px-3 py-2 text-rose-800">{error}</p>}
        {flash && <p className="rounded-md bg-emerald-50 px-3 py-2 text-emerald-800">{flash}</p>}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white text-sm shadow-sm">
        <h2 className="border-b border-slate-100 px-4 py-3 font-semibold">まだ渡していないもの({waiting.length})</h2>
        {waiting.length ? (
          <ul className="divide-y divide-slate-100">
            {waiting.map((m) => (
              <li key={m.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 ${m.forUserId === viewerId ? "bg-amber-50/50" : ""}`}>
                <span className={`rounded-full px-2 py-0.5 text-xs ${important(m.kind) ? "bg-rose-100 text-rose-800" : "bg-slate-100 text-slate-700"}`}>{kindLabel(m.kind)}</span>
                <span className="font-medium">{m.sender ?? "差出人なし"}</span>
                <span className="text-slate-600">→ {m.forName ?? "会社あて・どなたか"}</span>
                {m.note && <span className="w-full text-xs text-slate-500 sm:w-auto">{m.note}</span>}
                <span className="ml-auto flex items-center gap-3 text-xs text-slate-500">
                  {waitDays(m.receivedOn, today) >= 3 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-900">{waitDays(m.receivedOn, today)}日たっています</span>}
                  {md(m.receivedOn)} 受付 {m.takenByName}
                  {m.kind === "INVOICE" && (
                    <Link href="/inbox" className="text-indigo-700 hover:underline">
                      AI受付箱へ
                    </Link>
                  )}
                  <button onClick={() => hand(m.id, "HANDED")} disabled={busy === m.id} className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                    渡した
                  </button>
                  <button onClick={() => remove(m.id)} disabled={busy === m.id} className="hover:text-rose-700">
                    消す
                  </button>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-3 text-slate-500">まだ渡していない郵便物・荷物はありません。</p>
        )}
      </section>

      {handed.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white text-sm shadow-sm">
          <h2 className="border-b border-slate-100 px-4 py-3 font-semibold">渡したもの(30日)</h2>
          <ul className="divide-y divide-slate-100">
            {handed.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-slate-600">
                <span className="text-xs">{kindLabel(m.kind)}</span>
                <span>{m.sender ?? "差出人なし"}</span>
                <span className="text-xs">→ {m.handedTo ?? m.forName ?? ""}</span>
                <span className="ml-auto flex items-center gap-3 text-xs">
                  {md(m.receivedOn)} 受付
                  <button onClick={() => hand(m.id, "WAITING")} disabled={busy === m.id} className="hover:text-slate-900">
                    まだに戻す
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

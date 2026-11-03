"use client";

import { useState } from "react";

type U = { staffId: string; name: string; kind: "BIRTHDAY" | "ANNIVERSARY"; date: string; days: number; years: number | null; status: "SENT" | "SKIPPED" | null; hasEmail: boolean };
const md = (k: string) => `${Number(k.slice(5, 7))}/${Number(k.slice(8, 10))}`;
const key = (u: U) => `${u.staffId}-${u.kind}`;

export default function CelebrationsView({ initial }: { initial: U[] }) {
  const [list, setList] = useState(initial);
  const [open, setOpen] = useState<{ u: U; message: string; hint: string; announce: boolean; mode: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  async function call(url: string, method: string, body?: unknown) {
    const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "うまくいきませんでした");
    return json;
  }
  async function run(k: string, fn: () => Promise<void>) {
    setBusy(k);
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
  const load = async () => setList((await call("/api/celebrations", "GET")).upcoming);
  const draft = (u: U, useAi: boolean, hint = "") =>
    run(useAi ? "ai" : `d-${key(u)}`, async () => {
      const d = await call("/api/celebrations", "POST", { action: "draft", staffId: u.staffId, kind: u.kind, hint, useAi });
      setOpen({ u, message: d.message, hint, announce: open?.announce ?? false, mode: d.mode });
      if (useAi && d.mode !== "claude") setFlash("AIの言葉が条件に合わなかったので、決まった言葉のままにしました");
    });
  const send = () =>
    run("send", async () => {
      if (!open) return;
      const r = await call("/api/celebrations", "POST", { staffId: open.u.staffId, kind: open.u.kind, message: open.message, announce: open.announce });
      setFlash(`${open.u.name}さんにお祝いを送りました${r.mailed ? "(メール)" : r.hasUser ? "(アプリの通知)" : "(メールのアドレスがないので、送ったことだけ記録しました)"}${r.announced ? "・社内のお知らせにも出しました" : ""}`);
      setOpen(null);
      await load();
    });
  const skip = (u: U) =>
    run(`s-${key(u)}`, async () => {
      await call("/api/celebrations", "POST", { action: "skip", staffId: u.staffId, kind: u.kind });
      await load();
    });

  return (
    <div className="space-y-4">
      {error && <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}
      {flash && <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{flash}</p>}
      <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
        <h2 className="font-semibold">これから30日のお祝い({list.length}件)</h2>
        {list.length ? (
          <ul className="mt-2 divide-y divide-slate-100">
            {list.map((u) => (
              <li key={key(u)} className="space-y-2 py-2.5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="w-12 font-medium tabular-nums">{md(u.date)}</span>
                  <span className="font-medium">{u.name}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${u.kind === "BIRTHDAY" ? "bg-pink-50 text-pink-800 ring-1 ring-pink-200" : "bg-indigo-50 text-indigo-800 ring-1 ring-indigo-200"}`}>{u.kind === "BIRTHDAY" ? "誕生日" : `入社${u.years}年`}</span>
                  <span className="text-xs text-slate-500">{u.days === 0 ? "今日" : u.days === 1 ? "あした" : `あと${u.days}日`}</span>
                  {!u.hasEmail && <span className="text-xs text-slate-400">メールなし</span>}
                  <span className="ml-auto flex gap-2">
                    {u.status ? (
                      <span className="text-xs text-slate-500">{u.status === "SENT" ? "送りました" : "今年は見送り"}</span>
                    ) : (
                      <>
                        <button onClick={() => draft(u, false)} disabled={!!busy} className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs hover:bg-slate-50">
                          言葉を作る
                        </button>
                        <button onClick={() => skip(u)} disabled={!!busy} className="text-xs text-slate-400 hover:text-slate-700">
                          見送る
                        </button>
                      </>
                    )}
                  </span>
                </div>
                {open && key(open.u) === key(u) && (
                  <div className="space-y-2 rounded-md border border-slate-200 p-3">
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <input aria-label="ひとこと" value={open.hint} onChange={(e) => setOpen({ ...open, hint: e.target.value })} placeholder="その人の仕事ぶりなど(任意) 例: 新しいお客さまの担当をがんばってくれた" className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
                      <button onClick={() => draft(u, true, open.hint)} disabled={!!busy} className="shrink-0 rounded-md border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-xs text-indigo-800 hover:bg-indigo-100 disabled:opacity-50">
                        {busy === "ai" ? "AIが考えています…" : "AIで考える"}
                      </button>
                    </div>
                    {open.mode === "claude" && <p className="text-xs text-indigo-700">AIが考えました。送る前に読んでください</p>}
                    <textarea aria-label="お祝いの言葉" value={open.message} rows={6} onChange={(e) => setOpen({ ...open, message: e.target.value })} className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="flex items-center gap-1.5 text-xs">
                        <input type="checkbox" checked={open.announce} onChange={(e) => setOpen({ ...open, announce: e.target.checked })} />
                        社内のお知らせにも出す(短い文で、日にちと名前だけ)
                      </label>
                      <button onClick={send} disabled={!!busy} className="ml-auto rounded-md bg-vermilion-600 px-4 py-2 font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
                        {busy === "send" ? "送っています…" : "本人に送る"}
                      </button>
                      <button onClick={() => setOpen(null)} className="rounded-md border border-slate-300 bg-white px-3 py-2 hover:bg-slate-50">
                        やめる
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-slate-500">これから30日のお祝いはありません。労働者名簿に生年月日、スタッフに入社日を入れると出てきます。</p>
        )}
      </section>
    </div>
  );
}

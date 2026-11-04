"use client";

import { useCallback, useEffect, useState } from "react";

type Item = { id: string; name: string; price: number };
type ShopRow = { id: string; name: string; menu: Item[]; cutoff: string; weekdays: number[]; email: string | null; phone: string | null };
type DayShop = { id: string; name: string; cutoff: string; closed: boolean; email: string | null; phone: string | null; items: { name: string; price: number; qty: number; people: string[] }[]; total: number; count: number; sent: boolean };
type Data = { day: { date: string; allShops: ShopRow[]; shops: DayShop[] }; month: string; totals: { userId: string; name: string; total: number; unpaid: number; count: number }[] };
type Draft = { id?: string; name: string; menu: Item[]; cutoff: string; weekdays: number[]; email: string; phone: string; text: string; mode?: string };
const DAYS = "日月火水木金土";
const input = "w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm";
const yen = (n: number) => `${n.toLocaleString()}円`;

export default function BentoAdmin() {
  const [data, setData] = useState<Data | null>(null);
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
  const load = useCallback(async () => setData(await call("/api/bento", "GET")), []);
  useEffect(() => {
    fetch("/api/bento")
      .then((r) => (r.ok ? r.json() : null))
      .then((x) => x && setData(x))
      .catch(() => {});
  }, []);
  const readMenu = (useAi: boolean) =>
    run(useAi ? "ai" : "menu", async () => {
      if (!draft) return;
      const r = await call("/api/bento", "POST", { action: "menu", text: draft.text, useAi });
      setDraft({ ...draft, menu: r.menu, mode: r.mode });
      if (!r.menu.length) setError("メニューを読み取れませんでした。「のり弁 450円」のように、名前と値段を並べてください");
    });
  const saveShop = () =>
    run("save", async () => {
      if (!draft) return;
      const body = { name: draft.name, menu: draft.menu, cutoff: draft.cutoff, weekdays: draft.weekdays, email: draft.email, phone: draft.phone };
      if (draft.id) await call(`/api/bento/${draft.id}`, "PATCH", body);
      else await call("/api/bento", "POST", body);
      setFlash(`${draft.name}を${draft.id ? "直しました" : "登録しました"}`);
      setDraft(null);
      await load();
    });
  const send = (s: DayShop) =>
    run(`send-${s.id}`, async () => {
      if (!data || !confirm(`${s.name}に${s.count}個の注文をメールで送りますか?`)) return;
      await call("/api/bento", "POST", { action: "send", shopId: s.id, date: data.day.date });
      setFlash(`${s.name}に注文を送りました`);
      await load();
    });
  const paid = (userId: string, name: string) =>
    run(`paid-${userId}`, async () => {
      if (!data) return;
      await call("/api/bento", "POST", { action: "paid", userId, month: data.month });
      setFlash(`${name}さんの${Number(data.month.slice(5))}月分を集金済みにしました`);
      await load();
    });
  const blank: Draft = { name: "", menu: [], cutoff: "10:00", weekdays: [1, 2, 3, 4, 5], email: "", phone: "", text: "" };

  return (
    <div className="space-y-6">
      {error && <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}
      {flash && <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{flash}</p>}
      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold">今日の注文{data ? `(${Number(data.day.date.slice(5, 7))}/${Number(data.day.date.slice(8))})` : ""}</h2>
        </div>
        {!data ? (
          <p className="text-slate-500">読み込んでいます…</p>
        ) : data.day.shops.length === 0 ? (
          <p className="text-slate-500">今日頼めるお店はありません。</p>
        ) : (
          data.day.shops.map((s) => (
            <div key={s.id} className="rounded-md border border-slate-200 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{s.name}</span>
                <span className={`text-xs ${s.closed ? "text-rose-700" : "text-slate-500"}`}>{s.closed ? `締め切りました(${s.cutoff})` : `${s.cutoff}まで受付中`}</span>
                <span className="text-xs text-slate-600">
                  {s.count}個・{yen(s.total)}
                </span>
                <span className="ml-auto flex items-center gap-2">
                  {s.phone && <span className="text-xs text-slate-500">TEL {s.phone}</span>}
                  {s.sent && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800 ring-1 ring-emerald-200">お店に送りました</span>}
                  {s.email && s.count > 0 && !s.sent && (
                    <button onClick={() => send(s)} disabled={!!busy} className="rounded-md bg-vermilion-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
                      お店にメールで注文
                    </button>
                  )}
                </span>
              </div>
              {s.items.length ? (
                <ul className="mt-2 space-y-1">
                  {s.items.map((i) => (
                    <li key={i.name} className="flex flex-wrap gap-x-3">
                      <span className="w-36 font-medium">{i.name}</span>
                      <span className="w-12">{i.qty}個</span>
                      <span className="text-xs text-slate-500">{i.people.join("、")}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-xs text-slate-500">まだ注文はありません。</p>
              )}
            </div>
          ))
        )}
      </section>

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold">お店</h2>
          <button onClick={() => setDraft(blank)} className="ml-auto rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs hover:bg-slate-50">
            + お店を登録
          </button>
        </div>
        {data?.day.allShops.map((s) => (
          <div key={s.id} className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2">
            <span className="font-medium">{s.name}</span>
            <span className="text-xs text-slate-500">
              {s.weekdays.map((d) => DAYS[d]).join("")}・{s.cutoff}締め・{s.menu.map((m) => `${m.name} ${m.price}円`).join("/")}
            </span>
            <button onClick={() => setDraft({ id: s.id, name: s.name, menu: s.menu, cutoff: s.cutoff, weekdays: s.weekdays, email: s.email ?? "", phone: s.phone ?? "", text: "" })} className="ml-auto text-xs text-indigo-700 hover:underline">
              直す
            </button>
          </div>
        ))}
        {draft && (
          <div className="space-y-2 rounded-md border border-slate-200 p-3">
            <div className="grid gap-2 sm:grid-cols-[1fr_7rem_14rem_10rem]">
              <input aria-label="お店の名前" value={draft.name} placeholder="お店の名前" onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={input} />
              <input aria-label="締め切り" type="time" value={draft.cutoff} onChange={(e) => setDraft({ ...draft, cutoff: e.target.value })} className={input} />
              <input aria-label="お店のメール" value={draft.email} placeholder="お店のメール(任意)" onChange={(e) => setDraft({ ...draft, email: e.target.value })} className={input} />
              <input aria-label="お店の電話" value={draft.phone} placeholder="電話(任意)" onChange={(e) => setDraft({ ...draft, phone: e.target.value })} className={input} />
            </div>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                <button key={d} onClick={() => setDraft({ ...draft, weekdays: draft.weekdays.includes(d) ? draft.weekdays.filter((x) => x !== d) : [...draft.weekdays, d] })} aria-pressed={draft.weekdays.includes(d)} className={`h-8 w-8 rounded-md border text-sm ${draft.weekdays.includes(d) ? "border-indigo-400 bg-indigo-50 font-medium text-indigo-900" : "border-slate-300"}`}>
                  {DAYS[d]}
                </button>
              ))}
            </div>
            <textarea aria-label="メニューの文" value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} rows={3} placeholder="メニューを貼りつけ(例: のり弁 450円、唐揚げ弁当 550円、日替わり 500円)" className={input} />
            <div className="flex gap-2">
              <button onClick={() => readMenu(false)} disabled={!!busy || !draft.text.trim()} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs hover:bg-slate-50 disabled:opacity-50">
                読み取る
              </button>
              <button onClick={() => readMenu(true)} disabled={!!busy || !draft.text.trim()} className="rounded-md border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-xs text-indigo-800 hover:bg-indigo-100 disabled:opacity-50">
                {busy === "ai" ? "AIが読んでいます…" : "AIで読む"}
              </button>
              {draft.mode === "claude" && <span className="self-center text-xs text-indigo-700">AIが読みました。値段を確かめてください</span>}
            </div>
            <ul className="space-y-1">
              {draft.menu.map((m, k) => (
                <li key={k} className="flex items-center gap-2">
                  <input aria-label="品物" value={m.name} onChange={(e) => setDraft({ ...draft, menu: draft.menu.map((x, j) => (j === k ? { ...x, name: e.target.value } : x)) })} className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm" />
                  <input aria-label="値段" inputMode="numeric" value={m.price} onChange={(e) => setDraft({ ...draft, menu: draft.menu.map((x, j) => (j === k ? { ...x, price: Number(e.target.value.replace(/[^\d]/g, "")) || 0 } : x)) })} className="w-20 rounded-md border border-slate-300 px-2 py-1 text-right text-sm" />
                  <span className="text-xs text-slate-500">円</span>
                  <button onClick={() => setDraft({ ...draft, menu: draft.menu.filter((_, j) => j !== k) })} className="text-xs text-slate-400 hover:text-rose-700">
                    消す
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <button onClick={saveShop} disabled={!!busy} className="rounded-md bg-vermilion-600 px-4 py-2 font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
                {draft.id ? "直す" : "登録する"}
              </button>
              <button onClick={() => setDraft(null)} className="rounded-md border border-slate-300 bg-white px-3 py-2 hover:bg-slate-50">
                やめる
              </button>
            </div>
          </div>
        )}
      </section>

      {data && data.totals.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
          <h2 className="font-semibold">{Number(data.month.slice(5))}月の一人ずつの合計</h2>
          <ul className="mt-2 divide-y divide-slate-100">
            {data.totals.map((t) => (
              <li key={t.userId} className="flex flex-wrap items-center gap-3 py-1.5">
                <span className="w-32 font-medium">{t.name}</span>
                <span>
                  {t.count}個・{yen(t.total)}
                </span>
                {t.unpaid ? (
                  <>
                    <span className="text-xs text-amber-800">まだ {yen(t.unpaid)}</span>
                    <button onClick={() => paid(t.userId, t.name)} disabled={!!busy} className="ml-auto rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs hover:bg-slate-50">
                      集金した
                    </button>
                  </>
                ) : (
                  <span className="text-xs text-emerald-700">集金済み</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

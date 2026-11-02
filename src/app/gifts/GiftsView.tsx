"use client";

import Link from "next/link";
import { useState } from "react";

type Gift = { id: string; direction: string; season: string; date: string; partyKind: string | null; partyId: string | null; partyName: string; item: string | null; amount: number | null; thankedAt: string | null };
type Person = { partyKind: string | null; partyId: string | null; partyName: string; item: string | null; amount?: number | null };
type SeasonView = { season: string; label: string; sentTotal: number; sentCount: number; receivedCount: number; notYet: Person[]; notReturned: Person[] };
type Data = { year: number; records: Gift[]; seasons: SeasonView[] };
type Draft = { direction: "SENT" | "RECEIVED"; season: string; date: string; partyKind: string | null; partyId: string | null; partyName: string; item: string | null; amount: number | null };

const input = "w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm";
const SEASONS: Record<string, string> = { OSEIBO: "お歳暮", OCHUGEN: "お中元", OTHER: "そのほか" };
const md = (k: string) => `${Number(k.slice(5, 7))}/${Number(k.slice(8, 10))}`;
const thanksHref = (g: { partyKind: string | null; partyId: string | null; season: string; item: string | null }) =>
  `/letters/greeting?thanks=${encodeURIComponent(`このたびの${SEASONS[g.season] === "そのほか" ? "お心遣い" : `${SEASONS[g.season]}のお品`}${g.item ? `(${g.item})` : ""}`)}${g.partyKind && g.partyId ? `&party=${g.partyKind}:${g.partyId}` : ""}`;

export default function GiftsView({ initial }: { initial: Data }) {
  const [data, setData] = useState(initial);
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  async function call(url: string, body?: unknown) {
    const res = await fetch(url, { method: body ? "POST" : "GET", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
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
  const reload = async () => setData(await call(`/api/gifts?year=${data.year}`));
  const parse = () => run("parse", async () => setDraft((await call("/api/gifts", { action: "parse", text })).draft));
  const save = () =>
    run("save", async () => {
      const { gift } = await call("/api/gifts", draft);
      setFlash(`${gift.partyName}への${gift.direction === "RECEIVED" ? "いただきもの" : "贈りもの"}を記録しました`);
      setDraft(null);
      setText("");
      await reload();
    });
  const again = (p: Person, season: string) => {
    setDraft({ direction: "SENT", season, date: new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }), partyKind: p.partyKind, partyId: p.partyId, partyName: p.partyName, item: p.item, amount: p.amount ?? null });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const act = (g: Gift, body: Record<string, unknown>) => run(g.id, async () => {
    await call(`/api/gifts/${g.id}`, body);
    await reload();
  });

  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm sm:p-6">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && text.trim() && parse()} placeholder="例: さくら商事からお歳暮 洋菓子の詰め合わせ" className={input} />
          <button onClick={parse} disabled={!!busy || !text.trim()} className="shrink-0 rounded-md bg-vermilion-600 px-4 py-2 font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
            {busy === "parse" ? "読み取っています…" : "読み取る"}
          </button>
        </div>
        {draft && (
          <div className="space-y-2 rounded-md border border-slate-200 p-3">
            <div className="grid gap-2 sm:grid-cols-[8rem_7rem_9rem_1fr_1fr_7rem]">
              <select aria-label="いただいた・送った" value={draft.direction} onChange={(e) => setDraft({ ...draft, direction: e.target.value as Draft["direction"] })} className={input}>
                <option value="RECEIVED">いただいた</option>
                <option value="SENT">送った</option>
              </select>
              <select aria-label="季節" value={draft.season} onChange={(e) => setDraft({ ...draft, season: e.target.value })} className={input}>
                {Object.entries(SEASONS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              <input aria-label="日付" type="date" value={draft.date} onChange={(e) => e.target.value && setDraft({ ...draft, date: e.target.value })} className={input} />
              <input aria-label="相手" placeholder="相手" value={draft.partyName} onChange={(e) => setDraft({ ...draft, partyName: e.target.value, partyKind: null, partyId: null })} className={input} />
              <input aria-label="品物" placeholder="品物" value={draft.item ?? ""} onChange={(e) => setDraft({ ...draft, item: e.target.value || null })} className={input} />
              <input aria-label="金額" inputMode="numeric" placeholder="金額(円)" value={draft.amount ?? ""} onChange={(e) => setDraft({ ...draft, amount: e.target.value ? Number(e.target.value.replace(/\D/g, "")) : null })} className={input} />
            </div>
            <button onClick={save} disabled={!!busy} className="rounded-md bg-vermilion-600 px-4 py-2 font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
              {busy === "save" ? "記録しています…" : "記録する"}
            </button>
          </div>
        )}
        {error && <p className="rounded-md bg-rose-50 px-3 py-2 text-rose-800">{error}</p>}
        {flash && <p className="rounded-md bg-emerald-50 px-3 py-2 text-emerald-800">{flash}</p>}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {data.seasons.map((s) => (
          <section key={s.season} className="space-y-2 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
            <h2 className="font-semibold">
              {data.year}年の{s.label}
              <span className="ml-2 text-xs font-normal text-slate-500">
                送った {s.sentCount}件{s.sentTotal ? `・${s.sentTotal.toLocaleString()}円` : ""}・いただいた {s.receivedCount}件
              </span>
            </h2>
            {s.notYet.length > 0 && (
              <div>
                <p className="text-xs font-medium text-amber-800">去年送ったのに、今年まだの相手</p>
                <ul className="mt-1 space-y-1">
                  {s.notYet.map((p) => (
                    <li key={`${p.partyId ?? p.partyName}`} className="flex flex-wrap items-center gap-2">
                      <span>{p.partyName}</span>
                      <span className="text-xs text-slate-500">
                        去年: {p.item ?? "品物の記録なし"}
                        {p.amount ? ` ${p.amount.toLocaleString()}円` : ""}
                      </span>
                      <button onClick={() => again(p, s.season)} className="ml-auto rounded-md border border-slate-300 bg-white px-2 py-0.5 text-xs hover:bg-slate-50">
                        今年も送る
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {s.notReturned.length > 0 && (
              <div>
                <p className="text-xs font-medium text-indigo-800">いただいたのに、こちらから送っていない相手</p>
                <ul className="mt-1 space-y-1">
                  {s.notReturned.map((p) => (
                    <li key={`${p.partyId ?? p.partyName}`} className="flex flex-wrap items-center gap-2">
                      <span>{p.partyName}</span>
                      {p.item && <span className="text-xs text-slate-500">いただいたもの: {p.item}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {!s.notYet.length && !s.notReturned.length && <p className="text-xs text-slate-500">気になる相手はいません。</p>}
          </section>
        ))}
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
        <h2 className="font-semibold">{data.year}年の記録</h2>
        {data.records.length ? (
          <ul className="mt-2 divide-y divide-slate-100">
            {data.records.map((g) => (
              <li key={g.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span className="w-12 tabular-nums text-slate-600">{md(g.date)}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs ${g.direction === "RECEIVED" ? "bg-indigo-50 text-indigo-800" : "bg-slate-100 text-slate-700"}`}>
                  {SEASONS[g.season]}を{g.direction === "RECEIVED" ? "いただいた" : "送った"}
                </span>
                <span className="font-medium">{g.partyName}</span>
                {g.item && <span className="text-slate-600">{g.item}</span>}
                {g.amount ? <span className="tabular-nums text-slate-600">{g.amount.toLocaleString()}円</span> : null}
                <span className="ml-auto flex items-center gap-2">
                  {g.direction === "RECEIVED" &&
                    (g.thankedAt ? (
                      <button onClick={() => act(g, { action: "thanked", thanked: false })} className="text-xs text-emerald-700 hover:underline">
                        お礼済み
                      </button>
                    ) : (
                      <>
                        <Link href={thanksHref(g)} className="rounded-md bg-vermilion-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-vermilion-700">
                          お礼状を作る
                        </Link>
                        <button onClick={() => act(g, { action: "thanked" })} disabled={busy === g.id} className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs hover:bg-slate-50">
                          お礼をした
                        </button>
                      </>
                    ))}
                  <button onClick={() => confirm("この記録を消しますか?") && act(g, { action: "delete" })} className="text-xs text-slate-400 hover:text-rose-700">
                    消す
                  </button>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-slate-500">今年の記録はまだありません。</p>
        )}
      </section>
    </div>
  );
}

"use client";

import { useState } from "react";

type Seal = "JITSUIN" | "BANK" | "KAKUIN" | "OTHER";
type Row = { id: string; seal: Seal; document: string; party: string | null; copies: number; purpose: string | null; requestedByName: string; status: "REQUESTED" | "APPROVED" | "REJECTED" | "DONE"; decidedByName: string | null; reply: string | null; doneOn: string | null; pressedByName: string | null; createdAt: string };
type Data = { pending: Row[]; log: Row[] };
type Draft = { seal: Seal; document: string; party: string | null; copies: number; purpose: string | null };

const SEALS: Record<Seal, string> = { JITSUIN: "実印(代表者印)", BANK: "銀行印", KAKUIN: "角印(社印)", OTHER: "そのほかの印" };
const input = "w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm";
const day = (s: string) => new Date(s).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric" });
const ymd = (k: string) => `${Number(k.slice(0, 4))}/${Number(k.slice(5, 7))}/${Number(k.slice(8, 10))}`;

export default function SealsView({ initial }: { initial: Data }) {
  const [data, setData] = useState(initial);
  const [text, setText] = useState("");
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
  const load = async () => setData(await call("/api/seals", "GET"));
  const parse = () => run("parse", async () => setDraft((await call("/api/seals", "POST", { action: "parse", text })).draft));
  const save = () =>
    run("save", async () => {
      if (!draft) return;
      await call("/api/seals", "POST", draft);
      setFlash("申請に入れました。認めて押したら「押した」を押してください");
      setDraft(null);
      setText("");
      await load();
    });
  const act = (r: Row, action: string) =>
    run(`${r.id}-${action}`, async () => {
      let reply = "";
      if (action === "reject") {
        reply = prompt("見送る理由") ?? "";
        if (!reply.trim()) return;
      }
      await call(`/api/seals/${r.id}`, "PATCH", { action, reply });
      setFlash(action === "done" ? `${r.document}を押印簿に記録しました` : action === "approve" ? "認めました。押したら「押した」を押してください" : "見送りにしました");
      await load();
    });

  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm sm:p-6">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && text.trim() && parse()} placeholder="例: さくら商事との業務委託契約書 2部 実印" className={input} />
          <button onClick={parse} disabled={!!busy || !text.trim()} className="shrink-0 rounded-md bg-vermilion-600 px-4 py-2 font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
            {busy === "parse" ? "読み取っています…" : "読み取る"}
          </button>
        </div>
        {draft && (
          <div className="space-y-2 rounded-md border border-slate-200 p-3">
            <div className="grid gap-2 sm:grid-cols-[11rem_1fr_12rem_5rem]">
              <select aria-label="印" value={draft.seal} onChange={(e) => setDraft({ ...draft, seal: e.target.value as Seal })} className={input}>
                {(Object.keys(SEALS) as Seal[]).map((s) => (
                  <option key={s} value={s}>
                    {SEALS[s]}
                  </option>
                ))}
              </select>
              <input aria-label="書類" value={draft.document} onChange={(e) => setDraft({ ...draft, document: e.target.value })} className={input} />
              <input aria-label="相手先" value={draft.party ?? ""} placeholder="相手先" onChange={(e) => setDraft({ ...draft, party: e.target.value || null })} className={input} />
              <input aria-label="部数" inputMode="numeric" value={draft.copies} onChange={(e) => setDraft({ ...draft, copies: Number(e.target.value.replace(/[^\d]/g, "")) || 1 })} className={input} />
            </div>
            <input aria-label="使いみち" value={draft.purpose ?? ""} placeholder="使いみち(任意)" onChange={(e) => setDraft({ ...draft, purpose: e.target.value || null })} className={input} />
            <div className="flex gap-2">
              <button onClick={save} disabled={!!busy} className="rounded-md bg-vermilion-600 px-4 py-2 font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
                申請に入れる
              </button>
              <button onClick={() => setDraft(null)} className="rounded-md border border-slate-300 bg-white px-3 py-2 hover:bg-slate-50">
                やめる
              </button>
            </div>
          </div>
        )}
        {error && <p className="rounded-md bg-rose-50 px-3 py-2 text-rose-800">{error}</p>}
        {flash && <p className="rounded-md bg-emerald-50 px-3 py-2 text-emerald-800">{flash}</p>}
      </section>

      <section className="rounded-xl border border-amber-200 bg-white p-4 text-sm shadow-sm">
        <h2 className="font-semibold">申請中・押す前({data.pending.length}件)</h2>
        {data.pending.length ? (
          <ul className="mt-2 divide-y divide-slate-100">
            {data.pending.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span className={`rounded-full px-2 py-0.5 text-xs ${r.seal === "JITSUIN" || r.seal === "BANK" ? "bg-rose-50 text-rose-800 ring-1 ring-rose-200" : "bg-slate-100 text-slate-700"}`}>{SEALS[r.seal]}</span>
                <span className="font-medium">{r.document}</span>
                {r.party && <span className="text-xs text-slate-600">{r.party}</span>}
                <span className="text-xs text-slate-600">{r.copies}部</span>
                <span className="text-xs text-slate-500">
                  {r.requestedByName}・{day(r.createdAt)}
                  {r.purpose ? `・${r.purpose}` : ""}
                </span>
                {r.status === "APPROVED" && <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs text-sky-800 ring-1 ring-sky-200">認めた({r.decidedByName})</span>}
                <span className="ml-auto flex gap-2">
                  {r.status === "REQUESTED" && (
                    <button onClick={() => act(r, "approve")} disabled={!!busy} className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs hover:bg-slate-50">
                      認める
                    </button>
                  )}
                  <button onClick={() => act(r, "done")} disabled={!!busy} className="rounded-md bg-vermilion-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-vermilion-700">
                    押した
                  </button>
                  <button onClick={() => act(r, "reject")} disabled={!!busy} className="text-xs text-slate-400 hover:text-rose-700">
                    見送る
                  </button>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-slate-500">申請中のものはありません。</p>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
        <h2 className="font-semibold">押印簿(この1年・{data.log.length}件)</h2>
        {data.log.length ? (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-xs">
              <thead className="text-slate-500">
                <tr>
                  <th className="py-1.5 pr-2 font-normal">押した日</th>
                  <th className="pr-2 font-normal">印</th>
                  <th className="pr-2 font-normal">書類</th>
                  <th className="pr-2 font-normal">相手先</th>
                  <th className="pr-2 font-normal">部数</th>
                  <th className="pr-2 font-normal">頼んだ人</th>
                  <th className="pr-2 font-normal">認めた人</th>
                  <th className="font-normal">押した人</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.log.map((r) => (
                  <tr key={r.id} className={r.status === "REJECTED" ? "text-slate-400" : ""}>
                    <td className="py-1.5 pr-2">{r.doneOn ? ymd(r.doneOn) : "見送り"}</td>
                    <td className="pr-2">{SEALS[r.seal]}</td>
                    <td className="pr-2">
                      {r.document}
                      {r.reply ? `(${r.reply})` : ""}
                    </td>
                    <td className="pr-2">{r.party ?? ""}</td>
                    <td className="pr-2">{r.copies}</td>
                    <td className="pr-2">{r.requestedByName}</td>
                    <td className="pr-2">{r.decidedByName ?? ""}</td>
                    <td>{r.pressedByName ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-2 text-slate-500">まだ記録はありません。</p>
        )}
      </section>
    </div>
  );
}

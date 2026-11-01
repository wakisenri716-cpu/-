"use client";

import { useState } from "react";

type Answer = { userId: string; userName: string; answer: string; comment: string | null; paid: boolean };
type Event = { id: string; title: string; date: string; time: string | null; place: string | null; fee: number | null; deadline: string | null; note: string | null; closed: boolean; answers: Answer[]; counts: { YES: number; NO: number; MAYBE: number }; pending: { id: string; name: string }[]; paidCount: number; collected: number; cost: number | null; journalEntryId: string | null; companyShare: number | null };
type Fields = { title: string; date: string; time: string | null; place: string | null; fee: number | null; deadline: string | null; note: string | null };

const input = "w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm";
const ANSWERS: Record<string, string> = { YES: "出席", NO: "欠席", MAYBE: "未定" };
const jp = (k: string) => `${Number(k.slice(5, 7))}/${Number(k.slice(8, 10))}(${"日月火水木金土"[new Date(`${k}T00:00:00Z`).getUTCDay()]})`;

export default function EventsView({ initial, ai, today }: { initial: Event[]; ai: boolean; today: string }) {
  const [events, setEvents] = useState(initial);
  const [text, setText] = useState("");
  const [fields, setFields] = useState<Fields | null>(null);
  const [invite, setInvite] = useState<{ text: string; mode: string } | null>(null);
  const [announce, setAnnounce] = useState(true);
  const [notify, setNotify] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [costs, setCosts] = useState<Record<string, string>>({});
  const [payFrom, setPayFrom] = useState<"1010" | "1020">("1010");

  async function call(url: string, body?: unknown) {
    const res = await fetch(url, { method: body ? "POST" : "GET", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
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
  const reload = async () => setEvents((await call("/api/events")).events);
  const parse = () =>
    run("parse", async () => {
      const { fields: f } = await call("/api/events", { action: "parse", text });
      setFields(f);
      setInvite(await call("/api/events", { action: "draft", ...f, useAi: false }));
    });
  const draft = (useAi: boolean) =>
    run(useAi ? "ai" : "draft", async () => {
      setInvite(await call("/api/events", { action: "draft", ...fields, useAi }));
    });
  const create = () =>
    run("create", async () => {
      const r = await call("/api/events", { ...fields, announce, notify, text: invite?.text ?? "" });
      setFlash(`「${r.event.title}」を作りました${r.announced ? "。社内のお知らせに案内を出しました" : ""}${r.mailed ? `(メール ${r.mailed}通)` : ""}`);
      setFields(null);
      setInvite(null);
      setText("");
      await reload();
    });
  const act = (e: Event, body: Record<string, unknown>, done?: (r: { sent?: number; share?: number }) => string) =>
    run(`${e.id}-${String(body.action)}`, async () => {
      const r = await call(`/api/events/${e.id}`, body);
      if (done) setFlash(done(r));
      await reload();
    });

  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm sm:p-6">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && text.trim() && parse()} placeholder="例: 12/20 19時 忘年会 居酒屋さくら 会費5000円 締切12/10" className={input} />
          <button onClick={parse} disabled={!!busy || !text.trim()} className="shrink-0 rounded-md bg-vermilion-600 px-4 py-2 font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
            {busy === "parse" ? "読み取っています…" : "読み取る"}
          </button>
        </div>
        {fields && (
          <div className="space-y-3 rounded-md border border-slate-200 p-3">
            <div className="grid gap-2 sm:grid-cols-3">
              <input aria-label="イベントの名前" value={fields.title} onChange={(e) => setFields({ ...fields, title: e.target.value })} className={input} />
              <input aria-label="日付" type="date" value={fields.date} onChange={(e) => e.target.value && setFields({ ...fields, date: e.target.value })} className={input} />
              <input aria-label="時刻" type="time" value={fields.time ?? ""} onChange={(e) => setFields({ ...fields, time: e.target.value || null })} className={input} />
              <input aria-label="場所" placeholder="場所" value={fields.place ?? ""} onChange={(e) => setFields({ ...fields, place: e.target.value || null })} className={input} />
              <input aria-label="会費" inputMode="numeric" placeholder="会費(円)" value={fields.fee ?? ""} onChange={(e) => setFields({ ...fields, fee: e.target.value ? Number(e.target.value.replace(/\D/g, "")) : null })} className={input} />
              <label className="flex items-center gap-2 text-xs text-slate-600">
                締め切り
                <input aria-label="締め切り" type="date" value={fields.deadline ?? ""} onChange={(e) => setFields({ ...fields, deadline: e.target.value || null })} className={input} />
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-500">案内の文{invite?.mode === "claude" ? "(AIが書きました・直せます)" : "(直せます)"}</span>
              <button onClick={() => draft(false)} disabled={!!busy} className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs hover:bg-slate-50">
                入れた内容で作り直す
              </button>
              {ai && (
                <button onClick={() => draft(true)} disabled={!!busy} className="rounded-md border border-indigo-300 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50">
                  {busy === "ai" ? "AIが書いています…" : "AIで書き直す"}
                </button>
              )}
            </div>
            <textarea aria-label="案内の文" value={invite?.text ?? ""} onChange={(e) => setInvite({ text: e.target.value, mode: invite?.mode ?? "template" })} rows={9} className={`${input} leading-relaxed`} />
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={announce} onChange={(e) => setAnnounce(e.target.checked)} />
                社内のお知らせに案内を出す
              </label>
              {announce && (
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
                  メールでも知らせる
                </label>
              )}
              <button onClick={create} disabled={!!busy} className="ml-auto rounded-md bg-vermilion-600 px-4 py-2 font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
                {busy === "create" ? "作っています…" : "イベントを作る"}
              </button>
            </div>
          </div>
        )}
        {error && <p className="rounded-md bg-rose-50 px-3 py-2 text-rose-800">{error}</p>}
        {flash && <p className="rounded-md bg-emerald-50 px-3 py-2 text-emerald-800">{flash}</p>}
      </section>

      {events.length === 0 && <p className="rounded-xl border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">イベントはまだありません。</p>}
      {events.map((e) => {
        const past = e.date < today;
        return (
          <section key={e.id} className={`space-y-3 rounded-xl border bg-white p-4 text-sm shadow-sm ${past ? "border-slate-200 opacity-80" : "border-slate-200"}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-semibold">
                {e.title}
                <span className="ml-2 font-normal text-slate-600">
                  {jp(e.date)}
                  {e.time ? ` ${e.time}` : ""}
                  {e.place ? `・${e.place}` : ""}
                  {e.fee ? `・会費 ${e.fee.toLocaleString()}円` : ""}
                </span>
              </h2>
              <span className="text-xs text-slate-500">{past ? "終わりました" : e.closed ? "出欠を締めました" : e.deadline ? `締め切り ${jp(e.deadline)}` : "締め切りなし"}</span>
            </div>
            <p className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-800 ring-1 ring-emerald-200">出席 {e.counts.YES}</span>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-700">欠席 {e.counts.NO}</span>
              <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-900 ring-1 ring-amber-200">未定 {e.counts.MAYBE}</span>
              <span className="rounded-full bg-rose-50 px-2.5 py-1 text-rose-800 ring-1 ring-rose-200">まだ答えていない {e.pending.length}</span>
              {e.fee ? (
                <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-indigo-800 ring-1 ring-indigo-200">
                  会費 {e.paidCount}/{e.counts.YES}人・{e.collected.toLocaleString()}円
                </span>
              ) : null}
            </p>
            {e.answers.length > 0 && (
              <ul className="divide-y divide-slate-100">
                {e.answers.map((a) => (
                  <li key={a.userId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
                    <span className="font-medium">{a.userName}</span>
                    <span className={a.answer === "YES" ? "text-emerald-700" : a.answer === "NO" ? "text-slate-500" : "text-amber-700"}>{ANSWERS[a.answer] ?? a.answer}</span>
                    {a.comment && <span className="text-xs text-slate-500">{a.comment}</span>}
                    {e.fee && a.answer === "YES" ? (
                      <label className="ml-auto flex items-center gap-1 text-xs">
                        <input type="checkbox" checked={a.paid} disabled={!!busy} onChange={(ev) => act(e, { action: "paid", userId: a.userId, paid: ev.target.checked })} />
                        会費を受け取った
                      </label>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {e.pending.length > 0 && <p className="text-xs text-slate-500">まだ答えていない人: {e.pending.map((p) => p.name).join("、")}</p>}
            {(e.fee || e.cost != null || past) && (
              <div className="flex flex-wrap items-center gap-2 rounded-md bg-slate-50 px-3 py-2 text-xs">
                {e.journalEntryId ? (
                  <span className="text-emerald-700">
                    かかった金額 {e.cost?.toLocaleString()}円・会社の負担 {e.companyShare?.toLocaleString()}円を福利厚生費で仕訳しました(
                    <a href="/journal" className="underline">
                      仕訳帳
                    </a>
                    )
                  </span>
                ) : (
                  <>
                    <label className="flex items-center gap-1">
                      かかった金額
                      <input aria-label="かかった金額" inputMode="numeric" value={costs[e.id] ?? (e.cost != null ? String(e.cost) : "")} onChange={(ev) => setCosts({ ...costs, [e.id]: ev.target.value })} placeholder="例: 48000" className="w-28 rounded-md border border-slate-300 bg-white px-2 py-1" />円
                    </label>
                    <button onClick={() => act(e, { action: "cost", cost: costs[e.id] ?? "" })} disabled={!!busy} className="rounded-md border border-slate-300 bg-white px-2.5 py-1 hover:bg-slate-50 disabled:opacity-50">
                      保存
                    </button>
                    {e.companyShare != null && (
                      <>
                        <span className="text-slate-600">
                          会社の負担 {e.companyShare.toLocaleString()}円(かかった金額 − 受け取った会費 {e.collected.toLocaleString()}円)
                        </span>
                        {e.companyShare > 0 && (
                          <>
                            <select aria-label="払ったところ" value={payFrom} onChange={(ev) => setPayFrom(ev.target.value as "1010" | "1020")} className="rounded-md border border-slate-300 bg-white px-1.5 py-1">
                              <option value="1010">現金で払った</option>
                              <option value="1020">普通預金から払った</option>
                            </select>
                            <button onClick={() => act(e, { action: "post", payFrom }, (r) => `会社の負担 ${(r.share ?? 0).toLocaleString()}円を福利厚生費で仕訳しました`)} disabled={!!busy} className="rounded-md bg-vermilion-600 px-2.5 py-1 font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
                              会社の負担分を仕訳する
                            </button>
                          </>
                        )}
                      </>
                    )}
                  </>
                )}
              </div>
            )}
            {!past && (
              <div className="flex flex-wrap gap-2">
                {e.pending.length > 0 && !e.closed && (
                  <button onClick={() => act(e, { action: "remind" }, (r) => `答えていない人に催促のメールを${r.sent ?? 0}通送りました`)} disabled={!!busy} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs hover:bg-slate-50 disabled:opacity-50">
                    答えていない人に催促する
                  </button>
                )}
                <button onClick={() => act(e, { action: "close", closed: !e.closed })} disabled={!!busy} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs hover:bg-slate-50 disabled:opacity-50">
                  {e.closed ? "出欠の受付を再開する" : "出欠を締める"}
                </button>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

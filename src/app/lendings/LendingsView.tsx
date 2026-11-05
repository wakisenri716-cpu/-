"use client";

import { useState } from "react";

type Lending = { id: string; item: string; borrowerId: string | null; borrowerName: string; lentOn: string; dueOn: string | null; returnedOn: string | null; note: string | null; byName: string };
type Out = Lending & { overdueDays: number; days: number };
type Data = { today: string; out: Out[]; overdue: number; returned: Lending[]; frequent: string[] };
type Draft = { item: string; borrowerId: string | null; borrowerName: string; lentOn: string; dueOn: string | null; note: string | null };
const input = "w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm";
const md = (k: string) => `${Number(k.slice(5, 7))}/${Number(k.slice(8, 10))}`;

export default function LendingsView({ initial, users }: { initial: Data; users: { id: string; name: string }[] }) {
  const [data, setData] = useState(initial);
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dup, setDup] = useState(false);
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
  const load = async (query = "") => setData(await call(`/api/lendings${query ? `?q=${encodeURIComponent(query)}` : ""}`, "GET"));
  const parse = (t = text) => run("parse", async () => setDraft((await call("/api/lendings", "POST", { action: "parse", text: t })).draft));
  const save = () =>
    run("save", async () => {
      if (!draft) return;
      try {
        await call("/api/lendings", "POST", { ...draft, force: dup });
      } catch (e) {
        if (e instanceof Error && e.message.includes("貸したままです")) setDup(true);
        throw e;
      }
      setFlash(`${draft.item}を${draft.borrowerName}さんに貸した記録をつけました`);
      setDraft(null);
      setDup(false);
      setText("");
      await load();
    });
  const back = (r: Lending, undo = false) =>
    run(r.id, async () => {
      await call(`/api/lendings/${r.id}`, "PATCH", { action: "return", undo });
      setFlash(undo ? `${r.item}を貸し出し中に戻しました` : `${r.item}を返してもらいました`);
      await load(q.trim());
    });
  const extend = (r: Out, dueOn: string) =>
    run(r.id, async () => {
      await call(`/api/lendings/${r.id}`, "PATCH", { action: "extend", dueOn });
      await load(q.trim());
    });
  const remove = (r: Lending) =>
    run(r.id, async () => {
      if (!confirm(`${r.item}(${r.borrowerName}さん)の記録を消しますか?`)) return;
      await call(`/api/lendings/${r.id}`, "DELETE");
      await load(q.trim());
    });

  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm sm:p-6">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && text.trim() && parse()} placeholder="例: 会議室の鍵を山田さんに 金曜まで" className={input} />
          <button onClick={() => parse()} disabled={!!busy || !text.trim()} className="shrink-0 rounded-md bg-vermilion-600 px-4 py-2 font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
            {busy === "parse" ? "読み取っています…" : "読み取る"}
          </button>
        </div>
        {!!data.frequent.length && !draft && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-slate-500">よく貸すもの:</span>
            {data.frequent.map((f) => (
              <button key={f} onClick={() => setDraft({ item: f, borrowerId: null, borrowerName: "", lentOn: data.today, dueOn: null, note: null })} className="rounded-full border border-slate-300 px-2 py-0.5 hover:bg-slate-50">
                {f}
              </button>
            ))}
          </div>
        )}
        {draft && (
          <div className="space-y-2 rounded-md border border-slate-200 p-3">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              <input aria-label="貸したもの" placeholder="貸したもの" value={draft.item} onChange={(e) => setDraft({ ...draft, item: e.target.value })} className={input} />
              <div>
                <input aria-label="相手" placeholder="相手" list="lending-users" value={draft.borrowerName} onChange={(e) => setDraft({ ...draft, borrowerName: e.target.value, borrowerId: users.find((u) => u.name === e.target.value)?.id ?? null })} className={input} />
                <datalist id="lending-users">
                  {users.map((u) => (
                    <option key={u.id} value={u.name} />
                  ))}
                </datalist>
              </div>
              <label className="flex items-center gap-1 text-xs text-slate-500">
                <span className="shrink-0 whitespace-nowrap">貸した日</span>
                <input aria-label="貸した日" type="date" value={draft.lentOn} max={data.today} onChange={(e) => setDraft({ ...draft, lentOn: e.target.value })} className={input} />
              </label>
              <label className="flex items-center gap-1 text-xs text-slate-500">
                <span className="shrink-0 whitespace-nowrap">返す日</span>
                <input aria-label="返す日" type="date" value={draft.dueOn ?? ""} min={draft.lentOn} onChange={(e) => setDraft({ ...draft, dueOn: e.target.value || null })} className={input} />
              </label>
              <input aria-label="メモ" placeholder="メモ(社外の人の会社名など)" value={draft.note ?? ""} onChange={(e) => setDraft({ ...draft, note: e.target.value || null })} className={input} />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button onClick={save} disabled={!!busy} className="rounded-md bg-vermilion-600 px-4 py-2 font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
                {dup ? "それでも記録する" : "記録する"}
              </button>
              <button onClick={() => (setDraft(null), setDup(false))} className="rounded-md border border-slate-300 bg-white px-3 py-2 hover:bg-slate-50">
                やめる
              </button>
              {draft.borrowerId && <span className="text-xs text-emerald-700">社内の人: {draft.borrowerName}</span>}
            </div>
          </div>
        )}
        {error && <p className="rounded-md bg-rose-50 px-3 py-2 text-rose-800">{error}</p>}
        {flash && <p className="rounded-md bg-emerald-50 px-3 py-2 text-emerald-800">{flash}</p>}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold">
            いま貸し出し中({data.out.length}件{data.overdue ? `・返す日を過ぎたもの ${data.overdue}件` : ""})
          </h2>
          <input aria-label="探す" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && run("q", () => load(q.trim()))} placeholder="貸したもの・相手で探す" className="ml-auto w-56 rounded-md border border-slate-300 px-2 py-1 text-sm" />
        </div>
        {data.out.length ? (
          <ul className="mt-2 divide-y divide-slate-100">
            {data.out.map((r) => (
              <li key={r.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1 py-2 ${r.overdueDays ? "bg-rose-50/60" : ""}`}>
                <span className="font-medium">{r.item}</span>
                <span>{r.borrowerName}さん</span>
                <span className="text-xs text-slate-500">
                  {md(r.lentOn)}から{r.days ? `(${r.days}日)` : "(今日)"}
                </span>
                {r.dueOn && <span className={`rounded-full px-2 py-0.5 text-xs ${r.overdueDays ? "bg-rose-100 text-rose-800" : "bg-slate-100 text-slate-700"}`}>{r.overdueDays ? `${md(r.dueOn)}まで(${r.overdueDays}日過ぎ)` : `${md(r.dueOn)}まで`}</span>}
                {r.note && <span className="text-xs text-slate-500">{r.note}</span>}
                <span className="ml-auto flex items-center gap-2">
                  <input aria-label={`${r.item}の返す日を変える`} type="date" min={data.today} value="" onChange={(e) => e.target.value && extend(r, e.target.value)} className="w-8 rounded border border-slate-200 text-xs text-transparent" title="返す日を変える" />
                  <button onClick={() => back(r)} disabled={busy === r.id} className="rounded-md bg-vermilion-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
                    返してもらった
                  </button>
                  <button onClick={() => remove(r)} disabled={busy === r.id} className="text-xs text-slate-400 hover:text-rose-700">
                    消す
                  </button>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-slate-500">いま貸し出し中のものはありません。</p>
        )}
      </section>

      {!!data.returned.length && (
        <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
          <h2 className="font-semibold">返してもらったもの</h2>
          <ul className="mt-2 divide-y divide-slate-100">
            {data.returned.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-slate-600">
                <span>{r.item}</span>
                <span className="text-xs">{r.borrowerName}さん</span>
                <span className="text-xs">
                  {md(r.lentOn)}〜{r.returnedOn ? md(r.returnedOn) : ""}
                </span>
                <button onClick={() => back(r, true)} disabled={busy === r.id} className="ml-auto text-xs text-slate-400 hover:text-slate-700">
                  取り消す
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { formatYen } from "@/lib/format";

type Kind = "PREPAID_EXPENSE" | "DEFERRED_REVENUE";
type Row = {
  id: string;
  kind: Kind;
  name: string;
  totalAmount: number;
  startMonth: string;
  endMonth: string;
  months: number;
  accountCode: string;
  accountName: string;
  project: { id: string; name: string } | null;
  notes: string | null;
  active: boolean;
  opening: { date: string } | null;
  schedule: { month: string; amount: number; posted: boolean }[];
  postedCount: number;
  postedAmount: number;
  remaining: number;
  lastPosted: string | null;
  due: string[];
  done: boolean;
};
type Data = {
  thisMonth: string;
  rows: Row[];
  accounts: { code: string; name: string; category: string }[];
  projects: { id: string; name: string }[];
  counters: Record<Kind, { code: string; name: string }[]>;
  summary: { prepaidRemaining: number; deferredRemaining: number; expenseThisMonth: number; revenueThisMonth: number; due: number };
};

const KIND: Record<Kind, { label: string; short: string; balance: string; category: string; tone: string; example: string }> = {
  PREPAID_EXPENSE: { label: "まとめて払った費用", short: "前払費用", balance: "前払費用", category: "EXPENSE", tone: "bg-sky-50 text-sky-800", example: "例: 1年分の火災保険料・ソフトの年額利用料" },
  DEFERRED_REVENUE: { label: "まとめて受け取った売上", short: "前受金", balance: "前受金", category: "REVENUE", tone: "bg-emerald-50 text-emerald-800", example: "例: 1年分の保守料・年会費を前もって受け取った" },
};
const inputClass = "mt-1 w-full rounded-md border px-3 py-2 text-sm";
const ym = (m: string) => `${m.slice(0, 4)}/${Number(m.slice(5))}`;

function AllocationForm({ data, row, busy, onSubmit, onCancel }: { data: Data; row: Row | null; busy: boolean; onSubmit: (body: object) => void; onCancel: () => void }) {
  const [kind, setKind] = useState<Kind>(row?.kind ?? "PREPAID_EXPENSE");
  const [total, setTotal] = useState(row ? String(row.totalAmount) : "");
  const [months, setMonths] = useState(row ? String(row.months) : "12");
  const [startMonth, setStartMonth] = useState(row?.startMonth ?? data.thisMonth);
  const [withOpening, setWithOpening] = useState(false);
  const locked = !!row && row.postedCount > 0;
  const accounts = data.accounts.filter((a) => a.category === KIND[kind].category);
  const amount = Number(total.replaceAll(",", ""));
  const n = Number(months);
  const preview = Number.isInteger(amount) && amount > 0 && Number.isInteger(n) && n >= 2 && amount >= n ? { base: Math.floor(amount / n), last: amount - Math.floor(amount / n) * (n - 1) } : null;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    onSubmit({
      kind,
      name: f.name,
      totalAmount: total,
      startMonth,
      months,
      accountCode: f.accountCode,
      projectId: f.projectId,
      notes: f.notes,
      ...(withOpening ? { opening: { date: f.openingDate, counterCode: f.counterCode } } : {}),
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {!row && (
        <div className="grid gap-2 sm:grid-cols-2">
          {(Object.keys(KIND) as Kind[]).map((k) => (
            <label key={k} className={`cursor-pointer rounded-lg border p-3 text-sm ${kind === k ? "border-indigo-500 bg-indigo-50" : "border-slate-200"}`}>
              <input type="radio" name="kindRadio" checked={kind === k} onChange={() => setKind(k)} className="mr-2" />
              <span className="font-medium">{KIND[k].label}</span>
              <span className="block pl-5 text-xs text-slate-500">
                {KIND[k].short}にして毎月{k === "PREPAID_EXPENSE" ? "費用" : "売上"}にする。{KIND[k].example}
              </span>
            </label>
          ))}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm sm:col-span-2">
          <span className="text-slate-600">名前</span>
          <input name="name" required maxLength={60} defaultValue={row?.name} placeholder={kind === "PREPAID_EXPENSE" ? "例: 事務所の火災保険(2026年度)" : "例: ひかり商事 保守契約(年額)"} className={inputClass} />
        </label>
        <label className="block text-sm">
          <span className="text-slate-600">金額(円)</span>
          <input value={total} onChange={(e) => setTotal(e.target.value)} disabled={locked} required inputMode="numeric" placeholder="120,000" className={`${inputClass} disabled:bg-slate-50`} />
        </label>
        <label className="block text-sm">
          <span className="text-slate-600">{kind === "PREPAID_EXPENSE" ? "費用の科目" : "売上の科目"}</span>
          <select name="accountCode" defaultValue={row?.accountCode ?? (kind === "PREPAID_EXPENSE" ? "5170" : "4010")} disabled={locked} key={kind} className={`${inputClass} disabled:bg-slate-50`}>
            {accounts.map((a) => (
              <option key={a.code} value={a.code}>
                {a.code} {a.name}
              </option>
            ))}
          </select>
          {locked && <input type="hidden" name="accountCode" value={row!.accountCode} />}
        </label>
        <label className="block text-sm">
          <span className="text-slate-600">最初の月</span>
          <input type="month" value={startMonth} onChange={(e) => setStartMonth(e.target.value)} disabled={locked} required className={`${inputClass} disabled:bg-slate-50`} />
        </label>
        <label className="block text-sm">
          <span className="text-slate-600">按分する月数</span>
          <div className="mt-1 flex gap-1">
            <input value={months} onChange={(e) => setMonths(e.target.value)} disabled={locked} required inputMode="numeric" className="w-20 rounded-md border px-3 py-2 text-sm disabled:bg-slate-50" />
            {!locked &&
              [12, 24, 36].map((m) => (
                <button key={m} type="button" onClick={() => setMonths(String(m))} className="rounded-md border px-2 text-xs hover:bg-slate-50">
                  {m}か月
                </button>
              ))}
          </div>
        </label>
        <label className="block text-sm">
          <span className="text-slate-600">案件(任意)</span>
          <select name="projectId" defaultValue={row?.project?.id ?? ""} className={inputClass}>
            <option value="">なし</option>
            {row?.project && !data.projects.some((p) => p.id === row.project!.id) && <option value={row.project.id}>{row.project.name}</option>}
            {data.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-slate-600">メモ(任意)</span>
          <input name="notes" maxLength={300} defaultValue={row?.notes ?? ""} className={inputClass} />
        </label>
      </div>
      {preview && (
        <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">
          {ym(startMonth)}〜{ym(addMonth(startMonth, n - 1))}の{n}か月、毎月 <strong>{formatYen(preview.base)}</strong>
          {preview.last !== preview.base && `(最後の月は ${formatYen(preview.last)})`} を{kind === "PREPAID_EXPENSE" ? "費用" : "売上"}にします。仕訳の日付は各月の末日です。
        </p>
      )}
      {!row && (
        <div className="space-y-2 rounded-lg border border-slate-200 p-3 text-sm">
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={withOpening} onChange={(e) => setWithOpening(e.target.checked)} className="mt-1" />
            <span>
              {kind === "PREPAID_EXPENSE" ? "支払の仕訳も作る" : "入金の仕訳も作る"}
              <span className="block text-xs text-slate-500">
                まだ記帳していないときに。{kind === "PREPAID_EXPENSE" ? "前払費用 / 普通預金など" : "普通預金など / 前受金"} の仕訳を作ります。銀行明細などですでに記帳したときは、その仕訳の科目を「{KIND[kind].balance}」にしてください。
              </span>
            </span>
          </label>
          {withOpening && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-slate-600">{kind === "PREPAID_EXPENSE" ? "支払った日" : "受け取った日"}</span>
                <input name="openingDate" type="date" required defaultValue={`${startMonth}-01`} className={inputClass} />
              </label>
              <label className="block">
                <span className="text-slate-600">{kind === "PREPAID_EXPENSE" ? "支払った口座など" : "受け取った口座など"}</span>
                <select name="counterCode" defaultValue="1020" className={inputClass}>
                  {data.counters[kind].map((a) => (
                    <option key={a.code} value={a.code}>
                      {a.code} {a.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </div>
      )}
      <p className="text-xs text-slate-500">消費税は、支払・入金のときの仕訳で扱ってください(按分の仕訳には消費税を付けません)。</p>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-md border px-4 py-2 text-sm">
          やめる
        </button>
        <button type="submit" disabled={busy} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50">
          {busy ? "保存中..." : row ? "保存" : "登録"}
        </button>
      </div>
    </form>
  );
}

function addMonth(month: string, n: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default function AllocationsPage() {
  const [data, setData] = useState<Data | null>(null);
  const [editing, setEditing] = useState<Row | "new" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/allocations");
    if (res.ok) setData(await res.json());
  }, []);

  useEffect(() => {
    // Fetch-on-mount: setState always lands after the fetch's await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function call(url: string, method: string, body: object | undefined, done: (json: Record<string, unknown>) => string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(json.error || "処理できませんでした");
      return false;
    }
    setMessage(done(json));
    await load();
    return true;
  }

  async function save(body: object) {
    const ok =
      editing === "new"
        ? await call("/api/allocations", "POST", body, () => "期間按分を登録しました")
        : editing && (await call(`/api/allocations/${editing.id}`, "PATCH", body, () => "保存しました"));
    if (ok) setEditing(null);
  }

  const s = data?.summary;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">期間按分</h1>
          <p className="mt-1 text-sm text-slate-600">
            1年分の保険料やソフトの年額などをまとめて払ったとき(前払費用)、保守料・年会費などをまとめて受け取ったとき(前受金)に、毎月1か月分ずつ費用・売上にします。月ごとの損益が実態に近くなります。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {s && s.due > 0 && (
            <button
              onClick={() => call("/api/allocations", "POST", { action: "postDue" }, (j) => `${j.posted}か月分を計上しました${(j.errors as string[]).length ? `(計上できなかったもの: ${(j.errors as string[]).join("、")})` : ""}`)}
              disabled={busy}
              className="rounded-md border border-indigo-600 bg-white px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-50"
            >
              今月までの分をまとめて計上({s.due})
            </button>
          )}
          <button onClick={() => setEditing("new")} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700">
            + 按分を登録
          </button>
        </div>
      </div>

      {error && <div className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</div>}
      {message && <div className="rounded-md bg-emerald-50 px-4 py-2 text-sm text-emerald-800">{message}</div>}

      {s && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { label: "前払費用の残り(まだ費用にしていない額)", value: s.prepaidRemaining },
            { label: "前受金の残り(まだ売上にしていない額)", value: s.deferredRemaining },
            { label: "今月の按分の費用", value: s.expenseThisMonth },
            { label: "今月の按分の売上", value: s.revenueThisMonth },
          ].map((t) => (
            <div key={t.label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs text-slate-500">{t.label}</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{formatYen(t.value)}</p>
            </div>
          ))}
        </div>
      )}

      {data && (
        <div className="space-y-3">
          {data.rows.map((r) => {
            const monthly = r.schedule[0]?.amount ?? 0;
            return (
              <article key={r.id} className={`space-y-3 rounded-xl border bg-white p-4 shadow-sm ${r.due.length ? "border-amber-300" : "border-slate-200"} ${!r.active || r.done ? "opacity-75" : ""}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">
                      <span className={`mr-2 rounded px-1.5 py-0.5 text-xs font-normal ${KIND[r.kind].tone}`}>{KIND[r.kind].short}</span>
                      {r.name}
                      {!r.active && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-normal text-slate-600">止めています</span>}
                      {r.done && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-normal text-slate-600">完了</span>}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {[`${r.accountCode} ${r.accountName}`, r.project && `案件: ${r.project.name}`, r.opening && `${r.opening.date.replaceAll("-", "/")} ${r.kind === "PREPAID_EXPENSE" ? "支払" : "入金"}の仕訳あり`, r.notes].filter(Boolean).join(" / ")}
                    </p>
                  </div>
                  <div className="sm:text-right">
                    <p className="font-semibold tabular-nums">{formatYen(r.totalAmount)}</p>
                    <p className="text-xs text-slate-500">
                      {ym(r.startMonth)}〜{ym(r.endMonth)}・毎月 {formatYen(monthly)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-xs text-slate-600">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`${r.months}か月中${r.postedCount}か月を計上`}>
                    <div className="h-full rounded-full bg-indigo-500" style={{ width: `${(r.postedCount / r.months) * 100}%` }} />
                  </div>
                  <span className="whitespace-nowrap tabular-nums">
                    {r.postedCount}/{r.months}か月・残り {formatYen(r.remaining)}
                  </span>
                </div>
                {r.due.length > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    <span>
                      まだ計上していない月: {r.due.map(ym).join("、")}
                    </span>
                    <button
                      onClick={() => call(`/api/allocations/${r.id}`, "POST", { action: "post", month: r.due[0] }, (j) => `${ym(String(j.month))}分 ${formatYen(Number(j.amount))}を計上しました`)}
                      disabled={busy}
                      className="rounded-md bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700"
                    >
                      {ym(r.due[0])}分を計上
                    </button>
                  </div>
                )}
                <div className="flex flex-wrap gap-x-3 gap-y-1 border-t pt-2 text-sm">
                  <details className="w-full sm:w-auto">
                    <summary className="cursor-pointer text-slate-600 hover:underline">予定表</summary>
                    <ul className="mt-2 grid grid-cols-2 gap-x-6 gap-y-0.5 text-xs sm:grid-cols-3">
                      {r.schedule.map((m) => (
                        <li key={m.month} className="flex justify-between gap-2 tabular-nums">
                          <span>{ym(m.month)}</span>
                          <span className={m.posted ? "text-slate-700" : m.month <= data.thisMonth ? "text-amber-700" : "text-slate-400"}>
                            {formatYen(m.amount)} {m.posted ? "✓" : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </details>
                  <button onClick={() => setEditing(r)} className="text-slate-600 hover:underline">
                    編集
                  </button>
                  {r.lastPosted && (
                    <button
                      onClick={() => confirm(`${ym(r.lastPosted!)}分の計上を取り消しますか?(仕訳は取消になります)`) && call(`/api/allocations/${r.id}`, "POST", { action: "undo" }, (j) => `${ym(String(j.month))}分の計上を取り消しました`)}
                      disabled={busy}
                      className="text-slate-600 hover:underline"
                    >
                      {ym(r.lastPosted)}分の計上を取り消す
                    </button>
                  )}
                  {!r.done && (
                    <button onClick={() => call(`/api/allocations/${r.id}`, "PATCH", { active: !r.active }, () => (r.active ? "止めました。残りは計上しません" : "再開しました"))} disabled={busy} className="text-slate-600 hover:underline">
                      {r.active ? "止める" : "再開する"}
                    </button>
                  )}
                  {r.postedCount === 0 && (
                    <button
                      onClick={() => confirm(`「${r.name}」を削除しますか?${r.opening ? "支払・入金の仕訳も取消になります" : ""}`) && call(`/api/allocations/${r.id}`, "DELETE", undefined, () => "削除しました")}
                      disabled={busy}
                      className="text-slate-500 hover:text-rose-700 hover:underline"
                    >
                      削除
                    </button>
                  )}
                </div>
              </article>
            );
          })}
          {data.rows.length === 0 && (
            <p className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
              まだ登録がありません。「+ 按分を登録」から、まとめて払った保険料や、まとめて受け取った保守料などを登録してください。
            </p>
          )}
        </div>
      )}

      {editing && data && (
        <div className="fixed inset-0 z-20 flex items-end justify-center bg-slate-900/30 p-4 sm:items-center" onClick={() => setEditing(null)}>
          <div onClick={(e) => e.stopPropagation()} className="max-h-[90vh] w-full max-w-2xl space-y-3 overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
            <h2 className="font-semibold">{editing === "new" ? "按分を登録" : "按分を編集"}</h2>
            {editing !== "new" && editing.postedCount > 0 && <p className="text-xs text-slate-500">計上を始めた按分は、金額・科目・期間を変えられません(名前・案件・メモは変えられます)。</p>}
            <AllocationForm data={data} row={editing === "new" ? null : editing} busy={busy} onSubmit={save} onCancel={() => setEditing(null)} />
          </div>
        </div>
      )}
    </div>
  );
}

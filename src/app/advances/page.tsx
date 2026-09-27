"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { formatYen } from "@/lib/format";

type Advance = {
  id: string;
  employee: { id: string; name: string };
  purpose: string;
  amount: number;
  paidDate: string;
  payFrom: string;
  status: "OPEN" | "SETTLED" | "CANCELLED";
  settledDate: string | null;
  reportAmount: number | null;
  days: number;
};
type Report = { id: string; employeeId: string; amount: number; createdAt: string; itemCount: number };
type Data = { employees: { id: string; name: string }[]; reports: Report[]; advances: Advance[]; outstanding: number };

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const inputClass = "mt-1 block w-full rounded-md border px-3 py-2 text-sm";
const STATUS = {
  OPEN: { label: "精算待ち", className: "bg-amber-100 text-amber-800" },
  SETTLED: { label: "精算済み", className: "bg-emerald-100 text-emerald-800" },
  CANCELLED: { label: "取消", className: "bg-slate-100 text-slate-500" },
} as const;

export default function AdvancesPage() {
  const [data, setData] = useState<Data | null>(null);
  const [settling, setSettling] = useState<Advance | null>(null);
  const [reportId, setReportId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [formKey, setFormKey] = useState(0);

  const load = useCallback(async () => {
    const res = await fetch("/api/cash-advances");
    if (res.ok) setData(await res.json());
  }, []);

  useEffect(() => {
    // Fetch-on-mount: setState always lands after the fetch's await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function send(url: string, body: object, done: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(json.error || "処理できませんでした");
      return null;
    }
    setMessage(done);
    await load();
    return json;
  }

  async function give(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.currentTarget));
    if (await send("/api/cash-advances", body, `仮払金 ${formatYen(Number(String(body.amount).replaceAll(",", "")))} を記録しました`)) setFormKey((k) => k + 1);
  }

  async function settle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settling) return;
    const body = Object.fromEntries(new FormData(event.currentTarget));
    const json = await send(`/api/cash-advances/${settling.id}`, { action: "settle", ...body }, `${settling.employee.name}さんの仮払金を精算しました`);
    if (json) setSettling(null);
  }

  async function act(a: Advance, action: "undo" | "cancel") {
    const q = action === "undo" ? "精算を取り消しますか?(精算の仕訳は取消になり、経費精算は未精算に戻ります)" : "この仮払金を取り消しますか?(渡した仕訳は取消になります)";
    if (!confirm(q)) return;
    await send(`/api/cash-advances/${a.id}`, { action }, action === "undo" ? "精算を取り消しました" : "仮払金を取り消しました");
  }

  const reportsFor = settling ? (data?.reports ?? []).filter((r) => r.employeeId === settling.employee.id) : [];
  const chosen = reportsFor.find((r) => r.id === reportId);
  const diff = settling ? settling.amount - (chosen?.amount ?? 0) : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">仮払金</h1>
        <p className="mt-1 text-sm text-slate-600">
          出張や買い出しの前に、従業員へ先に渡したお金を記録します。使い終わったら、その人の経費精算と相殺して精算します。残りは返してもらい、足りなければ差額を払います。
        </p>
      </div>

      {error && <div className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</div>}
      {message && <div className="rounded-md bg-emerald-50 px-4 py-2 text-sm text-emerald-800">{message}</div>}

      {data && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs text-slate-500">精算待ちの仮払金</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{formatYen(data.outstanding)}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs text-slate-500">精算待ちの件数</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {data.advances.filter((a) => a.status === "OPEN").length}件
              {data.advances.some((a) => a.status === "OPEN" && a.days >= 30) && (
                <span className="ml-2 text-sm font-normal text-amber-700">うち30日以上たったもの {data.advances.filter((a) => a.status === "OPEN" && a.days >= 30).length}件</span>
              )}
            </p>
          </div>
        </div>
      )}

      {data && (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <h2 className="border-b px-4 py-3 font-semibold">渡した仮払金</h2>
          <ul className="divide-y text-sm">
            {data.advances.map((a) => (
              <li key={a.id} className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 ${a.status === "CANCELLED" ? "text-slate-400" : ""}`}>
                <div className="min-w-0">
                  <div className="font-medium">
                    {a.employee.name}さん ・ {a.purpose}
                    <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS[a.status].className}`}>{STATUS[a.status].label}</span>
                  </div>
                  <div className="text-xs text-slate-500">
                    {a.paidDate.replaceAll("-", "/")}に{a.payFrom}から {formatYen(a.amount)}
                    {a.status === "OPEN" && a.days >= 30 && <span className="ml-2 text-amber-700">渡してから{a.days}日たっています</span>}
                    {a.status === "SETTLED" &&
                      ` ・ ${a.settledDate?.replaceAll("-", "/")}に精算(経費 ${formatYen(a.reportAmount ?? 0)}・${
                        a.amount - (a.reportAmount ?? 0) > 0 ? `返金 ${formatYen(a.amount - (a.reportAmount ?? 0))}` : a.amount - (a.reportAmount ?? 0) < 0 ? `追加で支払 ${formatYen((a.reportAmount ?? 0) - a.amount)}` : "差額なし"
                      })`}
                  </div>
                </div>
                <div className="flex gap-3 text-xs">
                  {a.status === "OPEN" && (
                    <>
                      <button
                        onClick={() => {
                          setSettling(a);
                          setReportId("");
                        }}
                        className="font-medium text-indigo-700 hover:underline"
                      >
                        精算する
                      </button>
                      <button onClick={() => act(a, "cancel")} disabled={busy} className="text-slate-500 hover:text-rose-700 hover:underline">
                        取消
                      </button>
                    </>
                  )}
                  {a.status === "SETTLED" && (
                    <button onClick={() => act(a, "undo")} disabled={busy} className="text-slate-500 hover:underline">
                      精算を取り消す
                    </button>
                  )}
                </div>
              </li>
            ))}
            {data.advances.length === 0 && <li className="px-4 py-6 text-center text-slate-400">まだ仮払金はありません。</li>}
          </ul>
        </section>
      )}

      {data && (
        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="font-semibold">仮払金を渡す</h2>
          <form key={formKey} onSubmit={give} className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="text-slate-600">渡す人</span>
              <select name="employeeId" required className={inputClass}>
                <option value="">選んでください</option>
                {data.employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">用途</span>
              <input name="purpose" required maxLength={100} placeholder="例: 大阪出張の交通費・宿泊費" className={inputClass} />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">金額(円)</span>
              <input name="amount" required inputMode="numeric" placeholder="50000" className={inputClass} />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">渡した日</span>
              <input name="paidDate" type="date" required defaultValue={today()} className={inputClass} />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">お金の出どころ</span>
              <select name="payFrom" defaultValue="1010" className={inputClass}>
                <option value="1010">現金</option>
                <option value="1020">普通預金(振込)</option>
              </select>
            </label>
            <div className="flex items-end">
              <button disabled={busy} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
                記録する(仮払金 / 現金・預金)
              </button>
            </div>
          </form>
        </section>
      )}

      {settling && (
        <div className="fixed inset-0 z-20 flex items-end justify-center bg-slate-900/30 p-4 sm:items-center" onClick={() => setSettling(null)}>
          <form onSubmit={settle} onClick={(e) => e.stopPropagation()} className="max-h-[90vh] w-full max-w-lg space-y-3 overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
            <h2 className="font-semibold">
              {settling.employee.name}さんの仮払金 {formatYen(settling.amount)} を精算
            </h2>
            <label className="block text-sm">
              <span className="text-slate-600">相殺する経費精算</span>
              <select name="reportId" value={reportId} onChange={(e) => setReportId(e.target.value)} className={inputClass}>
                <option value="">なし(使わなかったので全額返してもらった)</option>
                {reportsFor.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.createdAt.replaceAll("-", "/")}作成 ・ {r.itemCount}件 ・ {formatYen(r.amount)}
                  </option>
                ))}
              </select>
              {reportsFor.length === 0 && (
                <span className="mt-1 block text-xs text-slate-500">
                  選べる経費精算がありません(レビュー・承認が済み、まだ精算していないものが出ます)。
                  <Link href="/reimbursements" className="ml-1 text-indigo-700 underline">
                    立替経費の精算
                  </Link>
                </span>
              )}
            </label>
            <div className="rounded-md bg-slate-50 px-3 py-2 text-sm">
              仮払金 {formatYen(settling.amount)} − 経費 {formatYen(chosen?.amount ?? 0)} ={" "}
              <span className="font-semibold">{diff > 0 ? `${formatYen(diff)} 返してもらう` : diff < 0 ? `${formatYen(-diff)} 追加で払う` : "差額なし"}</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="text-slate-600">精算した日</span>
                <input name="date" type="date" required defaultValue={today()} className={inputClass} />
              </label>
              <label className="block text-sm">
                <span className="text-slate-600">{diff >= 0 ? "返してもらった先" : "払った元"}</span>
                <select name="payFrom" defaultValue="1010" className={inputClass}>
                  <option value="1010">現金</option>
                  <option value="1020">普通預金</option>
                </select>
              </label>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setSettling(null)} className="rounded-md border px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
                やめる
              </button>
              <button disabled={busy} className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
                精算する
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

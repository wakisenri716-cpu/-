"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { formatYen } from "@/lib/format";

type Status = "over" | "overdue" | "near" | "ok" | "none";
type Row = {
  id: string;
  name: string;
  limit: number | null;
  balance: number;
  overdue: number;
  invoiceCount: number;
  available: number | null;
  usage: number | null;
  status: Status;
  reviewedAt: string | null;
  reviewDue: boolean;
  note: string | null;
};
type Data = {
  today: string;
  rows: Row[];
  customers: { id: string; name: string; limit: number | null }[];
  summary: { balance: number; overdue: number; over: number; near: number; noLimit: number; reviewDue: number };
};

const STATUS: Record<Status, [string, string]> = {
  over: ["上限を超えている", "bg-rose-50 text-rose-800"],
  overdue: ["期日を過ぎた売掛金あり", "bg-amber-50 text-amber-800"],
  near: ["上限が近い", "bg-amber-50 text-amber-800"],
  ok: ["問題なし", "bg-emerald-50 text-emerald-800"],
  none: ["上限なし", "bg-slate-100 text-slate-600"],
};
const inputClass = "mt-1 w-full rounded-md border px-3 py-2 text-sm";
const ymd = (d: string) => d.replaceAll("-", "/");

export default function CreditPage() {
  const [data, setData] = useState<Data | null>(null);
  const [editing, setEditing] = useState<{ id: string; name: string; row: Row | null } | null>(null);
  const [adding, setAdding] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/credit");
    if (res.ok) setData(await res.json());
  }, []);

  useEffect(() => {
    // Fetch-on-mount: setState always lands after the fetch's await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    const body = Object.fromEntries(new FormData(event.currentTarget));
    const res = await fetch(`/api/credit/${editing.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(json.error || "保存できませんでした");
    setMessage(`「${editing.name}」の与信限度額を${json.creditLimit === null ? "なし" : formatYen(json.creditLimit)}にしました`);
    setEditing(null);
    setAdding("");
    await load();
  }

  const s = data?.summary;
  const unset = data?.customers.filter((c) => c.limit === null && !data.rows.some((r) => r.id === c.id && r.limit !== null)) ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">与信管理</h1>
        <p className="mt-1 text-sm text-slate-600">
          顧客ごとに「売掛金をいくらまで残してよいか」(与信限度額)を決め、未回収の売掛金がどれだけ使っているかを確かめます。請求書を作るときに上限を超えそうなら、その場で知らせます。
        </p>
      </div>

      {error && <div className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</div>}
      {message && <div className="rounded-md bg-emerald-50 px-4 py-2 text-sm text-emerald-800">{message}</div>}

      {s && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { label: "売掛金の合計(未回収)", value: formatYen(s.balance) },
            { label: "うち期日を過ぎた分", value: formatYen(s.overdue), alert: s.overdue > 0 },
            { label: "上限を超えている顧客", value: `${s.over}社`, alert: s.over > 0 },
            { label: "上限が近い顧客(80%以上)", value: `${s.near}社` },
          ].map((t) => (
            <div key={t.label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs text-slate-500">{t.label}</p>
              <p className={`mt-1 text-xl font-semibold tabular-nums ${t.alert ? "text-rose-700" : ""}`}>{t.value}</p>
            </div>
          ))}
        </div>
      )}
      {s && (s.noLimit > 0 || s.reviewDue > 0) && (
        <div className="rounded-md bg-slate-50 px-4 py-2 text-sm text-slate-700">
          {s.noLimit > 0 && <span className="mr-3">売掛金があるのに上限を決めていない顧客が{s.noLimit}社あります。</span>}
          {s.reviewDue > 0 && <span>1年以上見直していない上限が{s.reviewDue}社あります(決算書や支払の様子を見て見直しましょう)。</span>}
        </div>
      )}

      {data && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs whitespace-nowrap text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">顧客</th>
                  <th className="px-3 py-2 text-right font-medium">与信限度額</th>
                  <th className="px-3 py-2 text-right font-medium">売掛金</th>
                  <th className="px-3 py-2 text-left font-medium">使用率</th>
                  <th className="px-3 py-2 text-right font-medium">残り枠</th>
                  <th className="px-3 py-2 text-left font-medium">状態</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="px-3 py-2">
                      <span className="font-medium whitespace-nowrap">{r.name}</span>
                      <span className="block text-xs text-slate-500">
                        {[r.invoiceCount ? `未回収の請求書 ${r.invoiceCount}件` : null, r.reviewedAt && `${ymd(r.reviewedAt)} 見直し`, r.note].filter(Boolean).join(" / ")}
                        {r.reviewDue && <span className="ml-1 text-amber-700">(見直しの時期)</span>}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{r.limit === null ? <span className="text-slate-400">なし</span> : formatYen(r.limit)}</td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                      {formatYen(r.balance)}
                      {r.overdue > 0 && <span className="block text-xs text-rose-700">期日超過 {formatYen(r.overdue)}</span>}
                    </td>
                    <td className="px-3 py-2">
                      {r.usage === null ? (
                        <span className="text-xs text-slate-400">-</span>
                      ) : (
                        <div className="flex min-w-32 items-center gap-2">
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`与信限度額の${r.usage}%`}>
                            <div className={`h-full rounded-full ${r.usage > 100 ? "bg-rose-500" : r.usage >= 80 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${Math.min(100, r.usage)}%` }} />
                          </div>
                          <span className={`text-xs tabular-nums ${r.usage > 100 ? "font-semibold text-rose-700" : "text-slate-600"}`}>{r.usage}%</span>
                        </div>
                      )}
                    </td>
                    <td className={`px-3 py-2 text-right tabular-nums whitespace-nowrap ${r.available !== null && r.available < 0 ? "text-rose-700" : ""}`}>
                      {r.available === null ? "-" : formatYen(r.available)}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs whitespace-nowrap ${STATUS[r.status][1]}`}>{STATUS[r.status][0]}</span>
                    </td>
                    <td className="px-3 py-2 text-right text-xs whitespace-nowrap">
                      <button onClick={() => setEditing({ id: r.id, name: r.name, row: r })} className="mr-3 font-medium text-indigo-700 hover:underline">
                        上限を設定
                      </button>
                      {r.balance > 0 && (
                        <Link href="/receivables" className="text-slate-600 hover:underline">
                          売掛金を見る
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
                {data.rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-slate-400">
                      未回収の売掛金も、与信限度額を決めた顧客もまだありません。下から顧客を選んで上限を決められます。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data && unset.length > 0 && (
        <div className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <label className="block min-w-0 flex-1 text-sm sm:max-w-xs">
            <span className="text-slate-600">ほかの顧客の上限を決める</span>
            <select value={adding} onChange={(e) => setAdding(e.target.value)} className={inputClass}>
              <option value="">顧客を選ぶ</option>
              {unset.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={() => {
              const c = unset.find((x) => x.id === adding);
              if (c) setEditing({ id: c.id, name: c.name, row: null });
            }}
            disabled={!adding}
            className="rounded-md bg-vermilion-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-vermilion-700 disabled:opacity-50"
          >
            上限を設定
          </button>
        </div>
      )}

      {editing && data && (
        <div className="fixed inset-0 z-20 flex items-end justify-center bg-slate-900/30 p-4 sm:items-center" onClick={() => setEditing(null)}>
          <form onClick={(e) => e.stopPropagation()} onSubmit={save} className="w-full max-w-md space-y-3 rounded-xl bg-white p-5 shadow-xl">
            <h2 className="font-semibold">「{editing.name}」の与信限度額</h2>
            {editing.row && editing.row.balance > 0 && <p className="text-sm text-slate-600">今の売掛金(未回収): {formatYen(editing.row.balance)}</p>}
            <label className="block text-sm">
              <span className="text-slate-600">与信限度額(円)</span>
              <input name="creditLimit" inputMode="numeric" defaultValue={editing.row?.limit ?? ""} placeholder="例: 1,000,000(空にすると上限なし)" className={inputClass} />
              <span className="mt-0.5 block text-xs text-slate-400">目安: 月の取引額 × (締め日から入金までの月数 + 1) くらい</span>
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">見直した日</span>
              <input name="creditReviewedAt" type="date" defaultValue={editing.row?.reviewedAt ?? data.today} className={inputClass} />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">メモ(任意)</span>
              <textarea name="creditNote" rows={2} maxLength={500} defaultValue={editing.row?.note ?? ""} placeholder="例: 帝国データバンク評点55・取引3年・支払遅れなし" className={inputClass} />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(null)} className="rounded-md border px-4 py-2 text-sm">
                やめる
              </button>
              <button disabled={busy} className="rounded-md bg-vermilion-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-vermilion-700 disabled:opacity-50">
                保存
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { formatDate, formatYen } from "@/lib/format";

type Row = {
  id: string;
  employee: { id: string; name: string };
  createdAt: string;
  itemCount: number;
  pending: number;
  amount: number;
  state: "PAID" | "REVIEWING" | "READY" | "NOTHING" | "AWAITING_APPROVAL";
  approvalStatus: "DRAFT" | "SUBMITTED" | "APPROVED" | "RETURNED";
  approvedByName: string | null;
  returnComment: string | null;
  reimbursedOn: string | null;
};

const STATE = {
  READY: { label: "精算待ち", className: "bg-amber-100 text-amber-800" },
  REVIEWING: { label: "レビュー待ちあり", className: "bg-slate-100 text-slate-600" },
  PAID: { label: "精算済み", className: "bg-emerald-100 text-emerald-800" },
  NOTHING: { label: "精算なし", className: "bg-slate-100 text-slate-500" },
  AWAITING_APPROVAL: { label: "承認待ち", className: "bg-sky-100 text-sky-800" },
} as const;

const APPROVAL_LABEL = { DRAFT: "未申請", SUBMITTED: "申請中", APPROVED: "承認済み", RETURNED: "差戻し" } as const;

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function ReimbursementsPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [date, setDate] = useState(todayKey);
  const [payFrom, setPayFrom] = useState("1020");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/reimbursements");
    setRows(res.ok ? await res.json() : []);
  }, []);

  useEffect(() => {
    // Fetch-on-mount: setState always lands after the fetch's await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function act(row: Row, method: "POST" | "DELETE") {
    if (method === "DELETE" && !window.confirm(`${row.employee.name}さんへの精算を取り消して「精算待ち」に戻しますか?`)) return;
    setBusy(row.id);
    setMessage(null);
    const res = await fetch(`/api/reimbursements/${row.id}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: method === "POST" ? JSON.stringify({ date, payFrom }) : undefined,
    });
    const body = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return setMessage({ ok: false, text: body.error || "処理に失敗しました" });
    setMessage({
      ok: true,
      text: method === "POST" ? `${row.employee.name}さんに ${formatYen(row.amount)} を精算しました(未払金 / ${payFrom === "1010" ? "現金" : "普通預金"} の仕訳を記帳)` : "精算を取り消しました",
    });
    load();
  }

  async function review(row: Row, action: "approve" | "return") {
    let comment = "";
    if (action === "return") {
      comment = window.prompt(`${row.employee.name}さんに差戻す理由を入力してください`) ?? "";
      if (!comment.trim()) return;
    }
    setBusy(row.id);
    setMessage(null);
    const res = await fetch(`/api/reimbursements/${row.id}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comment }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return setMessage({ ok: false, text: body.error || "処理に失敗しました" });
    setMessage({ ok: true, text: action === "approve" ? `${row.employee.name}さんの経費精算を承認しました` : `${row.employee.name}さんの経費精算を差戻しました` });
    load();
  }

  const byEmployee = new Map<string, { name: string; amount: number }>();
  for (const r of rows ?? []) {
    if (r.state !== "READY") continue;
    const e = byEmployee.get(r.employee.id) ?? { name: r.employee.name, amount: 0 };
    e.amount += r.amount;
    byEmployee.set(r.employee.id, e);
  }
  const waiting = [...byEmployee.values()];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">立替経費の精算</h1>
        <p className="mt-1 text-sm text-slate-600">
          従業員が立て替えた経費(経費精算で記帳済みのもの)を本人に支払ったら「精算する」を押します。「未払金 / 普通預金(または現金)」の仕訳を記帳します。
        </p>
      </div>

      {message && (
        <div className={`rounded-md px-4 py-2 text-sm ${message.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"}`}>{message.text}</div>
      )}

      {waiting.length > 0 && (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <h2 className="text-sm font-semibold text-amber-900">支払が必要な金額</h2>
          <ul className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
            {waiting.map((e) => (
              <li key={e.name}>
                {e.name}さん <span className="font-semibold tabular-nums">{formatYen(e.amount)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <label className="text-xs text-slate-500">
          支払日
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 block rounded-md border px-2 py-1.5 text-sm text-slate-900" />
        </label>
        <label className="text-xs text-slate-500">
          支払方法
          <select value={payFrom} onChange={(e) => setPayFrom(e.target.value)} className="mt-1 block rounded-md border px-2 py-1.5 text-sm text-slate-900">
            <option value="1020">銀行振込(普通預金)</option>
            <option value="1010">現金</option>
          </select>
        </label>
        <p className="text-xs text-slate-500">「精算する」を押したときに、この支払日・支払方法で記帳します。</p>
      </div>

      {rows === null ? (
        <p className="text-sm text-slate-500">読み込み中...</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs whitespace-nowrap text-slate-500">
                <tr>
                  <th className="px-4 py-2">従業員</th>
                  <th className="px-4 py-2">作成日</th>
                  <th className="px-4 py-2 text-right">明細</th>
                  <th className="px-4 py-2 text-right">精算額</th>
                  <th className="px-4 py-2">状態</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-2 whitespace-nowrap">{r.employee.name}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{formatDate(r.createdAt)}</td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      {r.itemCount}件{r.pending > 0 && <span className="text-xs text-amber-700">(レビュー待ち{r.pending})</span>}
                    </td>
                    <td className="px-4 py-2 text-right font-medium tabular-nums whitespace-nowrap">{formatYen(r.amount)}</td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATE[r.state].className}`}>{STATE[r.state].label}</span>
                      {r.reimbursedOn && <span className="ml-2 text-xs text-slate-500">{formatDate(r.reimbursedOn)}</span>}
                      {r.state === "AWAITING_APPROVAL" && <span className="ml-2 text-xs text-slate-500">{APPROVAL_LABEL[r.approvalStatus]}</span>}
                      {r.state === "READY" && r.approvedByName && <span className="ml-2 text-xs text-slate-500">承認: {r.approvedByName}</span>}
                    </td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      {r.approvalStatus === "SUBMITTED" && !r.reimbursedOn && (
                        <span className="mr-3 inline-flex gap-2">
                          <button onClick={() => review(r, "approve")} disabled={busy === r.id} className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                            承認
                          </button>
                          <button onClick={() => review(r, "return")} disabled={busy === r.id} className="text-xs text-rose-600 hover:underline disabled:opacity-50">
                            差戻し
                          </button>
                        </span>
                      )}
                      {r.approvalStatus === "APPROVED" && r.state === "READY" && (
                        <button onClick={() => review(r, "return")} disabled={busy === r.id} className="mr-3 text-xs text-rose-600 hover:underline disabled:opacity-50">
                          差戻し
                        </button>
                      )}
                      {r.state === "READY" && (
                        <button
                          onClick={() => act(r, "POST")}
                          disabled={busy === r.id}
                          className="rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                        >
                          精算する
                        </button>
                      )}
                      {r.state === "PAID" && (
                        <button onClick={() => act(r, "DELETE")} disabled={busy === r.id} className="text-xs text-slate-500 hover:underline disabled:opacity-50">
                          取り消す
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                      レシートが登録された経費精算はまだありません。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <p className="text-xs text-slate-500">
        銀行明細を取り込んでいる場合、ここで精算した振込は銀行明細の画面で「対象外」にしてください(二重に記帳されるのを防ぐため)。
      </p>
    </div>
  );
}

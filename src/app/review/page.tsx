"use client";

import { useEffect, useState } from "react";
import { formatDate, formatYen } from "@/lib/format";

type Line = { id: string; debit: number; credit: number; account: { code: string; name: string; category: string } };

type ReviewEntry = {
  id: string;
  date: string;
  description: string;
  sourceType: "EXPENSE_ITEM" | "INVOICE";
  lines: Line[];
  expenseItem: {
    description: string;
    amount: number;
    vendor: { name: string } | null;
    aiExtraction: { confidence: number; rawResponse: { notes?: string } } | null;
    expenseReport: { employee: { name: string } };
  } | null;
  invoice: {
    direction: "ISSUED" | "RECEIVED";
    invoiceNumber: string | null;
    totalAmount: number;
    vendor: { name: string } | null;
    customer: { name: string } | null;
    aiExtraction: { confidence: number; rawResponse: { notes?: string } } | null;
  } | null;
};

type Account = { id: string; code: string; name: string };

export default function ReviewQueuePage() {
  const [entries, setEntries] = useState<ReviewEntry[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [corrections, setCorrections] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [entriesRes, accountsRes] = await Promise.all([fetch("/api/review-queue"), fetch("/api/accounts")]);
    setEntries(await entriesRes.json());
    setAccounts(await accountsRes.json());
    setLoading(false);
  }

  useEffect(() => {
    // Fetch-on-mount: the resulting setState always lands after the fetch's
    // await, so the extra render this rule warns about never happens here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  async function act(entryId: string, action: "approve" | "reject") {
    setBusyId(entryId);
    setError(null);
    try {
      const correctedAccountId = corrections[entryId];
      const res = await fetch(`/api/review-queue/${entryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, correctedAccountId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "処理に失敗しました");
      setEntries((prev) => prev.filter((entry) => entry.id !== entryId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">レビューキュー</h1>
        <p className="mt-1 text-sm text-slate-600">
          AIの信頼度が閾値未満、または金額が自動処理上限を超えた項目です。勘定科目を修正して承認するか、却下してください。
        </p>
      </div>

      {error && <div className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</div>}
      {loading && <p className="text-sm text-slate-500">読み込み中...</p>}
      {!loading && entries.length === 0 && (
        <p className="rounded-lg border bg-white p-6 text-center text-sm text-slate-400">
          レビュー待ちの項目はありません。
        </p>
      )}

      <div className="space-y-4">
        {entries.map((entry) => {
          const isExpense = entry.sourceType === "EXPENSE_ITEM";
          const ai = entry.expenseItem?.aiExtraction ?? entry.invoice?.aiExtraction;
          const counterparty = isExpense
            ? entry.expenseItem?.vendor?.name
            : entry.invoice?.vendor?.name ?? entry.invoice?.customer?.name;
          const amount = isExpense ? entry.expenseItem?.amount ?? 0 : entry.invoice?.totalAmount ?? 0;

          return (
            <div key={entry.id} className="rounded-lg border bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-medium">{entry.description}</div>
                  <div className="text-xs text-slate-500">
                    {formatDate(entry.date)} ・ {counterparty ?? "取引先不明"} ・ {formatYen(amount)}
                  </div>
                  {ai && (
                    <div className="mt-1 text-xs text-amber-700">
                      AI信頼度 {(ai.confidence * 100).toFixed(0)}%
                      {ai.rawResponse?.notes ? ` — ${ai.rawResponse.notes}` : ""}
                    </div>
                  )}
                </div>
              </div>

              <table className="mt-3 w-full text-sm">
                <tbody>
                  {entry.lines.map((line) => (
                    <tr key={line.id}>
                      <td className="py-0.5">
                        {line.account.code} {line.account.name}
                      </td>
                      <td className="py-0.5 text-right">
                        {line.debit > 0 ? `借方 ${formatYen(line.debit)}` : `貸方 ${formatYen(line.credit)}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="mt-3 flex flex-wrap items-center gap-3 border-t pt-3">
                {isExpense || entry.invoice?.direction === "RECEIVED" ? (
                  <select
                    className="rounded border px-2 py-1 text-sm"
                    value={corrections[entry.id] ?? ""}
                    onChange={(e) => setCorrections((prev) => ({ ...prev, [entry.id]: e.target.value }))}
                  >
                    <option value="">勘定科目をAI提案のまま承認</option>
                    {accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.code} {account.name} に修正
                      </option>
                    ))}
                  </select>
                ) : null}
                <button
                  onClick={() => act(entry.id, "approve")}
                  disabled={busyId === entry.id}
                  className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                >
                  承認して記帳
                </button>
                <button
                  onClick={() => act(entry.id, "reject")}
                  disabled={busyId === entry.id}
                  className="rounded-md bg-rose-100 px-3 py-1.5 text-sm font-medium text-rose-700 disabled:opacity-50"
                >
                  却下
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

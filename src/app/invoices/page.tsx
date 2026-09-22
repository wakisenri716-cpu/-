"use client";

import { useEffect, useState, type FormEvent } from "react";
import { formatDate, formatYen } from "@/lib/format";
import { StatusBadge } from "@/components/StatusBadge";

type Invoice = {
  id: string;
  direction: "ISSUED" | "RECEIVED";
  status: string;
  invoiceNumber: string | null;
  issueDate: string | null;
  dueDate: string | null;
  totalAmount: number;
  vendor: { name: string } | null;
  customer: { name: string } | null;
  aiExtraction: { confidence: number } | null;
  payments: { amount: number }[];
};

const SETTLEABLE_STATUSES = new Set(["CONFIRMED", "SENT", "PARTIALLY_PAID", "OVERDUE"]);

const TABS: { key: Invoice["direction"]; label: string; hint: string }[] = [
  { key: "RECEIVED", label: "受領請求書(支払)", hint: "取引先から届いた請求書をアップロードすると、AIが金額・税額・勘定科目を読み取り買掛金として仕訳します。" },
  { key: "ISSUED", label: "発行請求書(売上)", hint: "自社が発行した請求書をアップロードすると、AIが売上・売掛金として仕訳します。" },
];

export default function InvoicesPage() {
  const [direction, setDirection] = useState<Invoice["direction"]>("RECEIVED");
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paymentAmounts, setPaymentAmounts] = useState<Record<string, string>>({});
  const [payingId, setPayingId] = useState<string | null>(null);

  async function load(dir: Invoice["direction"]) {
    const res = await fetch(`/api/invoices?direction=${dir}`);
    setInvoices(await res.json());
    setLoading(false);
  }

  useEffect(() => {
    // Fetch-on-mount/tab-switch: the resulting setState always lands after
    // the fetch's await, so the extra render this rule warns about never
    // happens here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(direction);
  }, [direction]);

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    formData.set("direction", direction);
    setUploading(true);
    setError(null);
    try {
      const res = await fetch("/api/invoices", { method: "POST", body: formData });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "登録に失敗しました");
      form.reset();
      await load(direction);
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
    } finally {
      setUploading(false);
    }
  }

  async function recordPayment(invoiceId: string) {
    const amount = Number(paymentAmounts[invoiceId]);
    if (!amount || amount <= 0) {
      setError("金額を入力してください");
      return;
    }
    setPayingId(invoiceId);
    setError(null);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "記録に失敗しました");
      setPaymentAmounts((prev) => ({ ...prev, [invoiceId]: "" }));
      await load(direction);
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
    } finally {
      setPayingId(null);
    }
  }

  const activeTab = TABS.find((tab) => tab.key === direction)!;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">請求書</h1>
        <p className="mt-1 text-sm text-slate-600">{activeTab.hint}</p>
      </div>

      <div className="flex gap-2 border-b">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setDirection(tab.key)}
            className={`px-3 py-2 text-sm font-medium ${
              direction === tab.key ? "border-b-2 border-indigo-600 text-indigo-700" : "text-slate-500"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error && <div className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</div>}

      <form onSubmit={handleUpload} className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white shadow-sm p-4">
        <div>
          <label className="block text-xs text-slate-500">請求書ファイル(画像)</label>
          <input type="file" name="file" accept="image/*" required className="text-sm" />
        </div>
        <button
          type="submit"
          disabled={uploading}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
        >
          {uploading ? "AI解析中..." : "アップロードしてAI処理"}
        </button>
      </form>

      {loading ? (
        <p className="text-sm text-slate-500">読み込み中...</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2">請求書番号</th>
                <th className="px-4 py-2">{direction === "RECEIVED" ? "取引先" : "顧客"}</th>
                <th className="px-4 py-2">発行日</th>
                <th className="px-4 py-2">期日</th>
                <th className="px-4 py-2">金額</th>
                <th className="px-4 py-2">残高</th>
                <th className="px-4 py-2">AI信頼度</th>
                <th className="px-4 py-2">ステータス</th>
                <th className="px-4 py-2">{direction === "RECEIVED" ? "支払記録" : "入金記録"}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {invoices.map((invoice) => {
                const paid = invoice.payments.reduce((sum, p) => sum + p.amount, 0);
                const remaining = invoice.totalAmount - paid;
                const canSettle = SETTLEABLE_STATUSES.has(invoice.status) && remaining > 0;
                return (
                  <tr key={invoice.id}>
                    <td className="px-4 py-2 whitespace-nowrap">{invoice.invoiceNumber ?? "-"}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{invoice.vendor?.name ?? invoice.customer?.name ?? "-"}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{formatDate(invoice.issueDate)}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{formatDate(invoice.dueDate)}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{formatYen(invoice.totalAmount)}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{formatYen(remaining)}</td>
                    <td className="px-4 py-2">
                      {invoice.aiExtraction ? `${(invoice.aiExtraction.confidence * 100).toFixed(0)}%` : "-"}
                    </td>
                    <td className="px-4 py-2">
                      <StatusBadge status={invoice.status} />
                    </td>
                    <td className="px-4 py-2">
                      {canSettle ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            placeholder={String(remaining)}
                            value={paymentAmounts[invoice.id] ?? ""}
                            onChange={(e) =>
                              setPaymentAmounts((prev) => ({ ...prev, [invoice.id]: e.target.value }))
                            }
                            className="w-24 rounded border px-2 py-1 text-sm"
                          />
                          <button
                            onClick={() => recordPayment(invoice.id)}
                            disabled={payingId === invoice.id}
                            className="rounded-md bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                          >
                            記録
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">-</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {invoices.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-6 text-center text-slate-400">
                    まだ請求書がありません。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  );
}

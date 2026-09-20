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
};

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

  async function load(dir: Invoice["direction"]) {
    setLoading(true);
    const res = await fetch(`/api/invoices?direction=${dir}`);
    setInvoices(await res.json());
    setLoading(false);
  }

  useEffect(() => {
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
              direction === tab.key ? "border-b-2 border-slate-900 text-slate-900" : "text-slate-500"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error && <div className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</div>}

      <form onSubmit={handleUpload} className="flex flex-wrap items-end gap-3 rounded-lg border bg-white p-4">
        <div>
          <label className="block text-xs text-slate-500">請求書ファイル(画像)</label>
          <input type="file" name="file" accept="image/*" required className="text-sm" />
        </div>
        <button
          type="submit"
          disabled={uploading}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {uploading ? "AI解析中..." : "アップロードしてAI処理"}
        </button>
      </form>

      {loading ? (
        <p className="text-sm text-slate-500">読み込み中...</p>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2">請求書番号</th>
                <th className="px-4 py-2">{direction === "RECEIVED" ? "取引先" : "顧客"}</th>
                <th className="px-4 py-2">発行日</th>
                <th className="px-4 py-2">期日</th>
                <th className="px-4 py-2">金額</th>
                <th className="px-4 py-2">AI信頼度</th>
                <th className="px-4 py-2">ステータス</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {invoices.map((invoice) => (
                <tr key={invoice.id}>
                  <td className="px-4 py-2 whitespace-nowrap">{invoice.invoiceNumber ?? "-"}</td>
                  <td className="px-4 py-2">{invoice.vendor?.name ?? invoice.customer?.name ?? "-"}</td>
                  <td className="px-4 py-2 whitespace-nowrap">{formatDate(invoice.issueDate)}</td>
                  <td className="px-4 py-2 whitespace-nowrap">{formatDate(invoice.dueDate)}</td>
                  <td className="px-4 py-2 whitespace-nowrap">{formatYen(invoice.totalAmount)}</td>
                  <td className="px-4 py-2">
                    {invoice.aiExtraction ? `${(invoice.aiExtraction.confidence * 100).toFixed(0)}%` : "-"}
                  </td>
                  <td className="px-4 py-2">
                    <StatusBadge status={invoice.status} />
                  </td>
                </tr>
              ))}
              {invoices.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-slate-400">
                    まだ請求書がありません。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

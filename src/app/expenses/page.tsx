"use client";

import { useEffect, useState, type FormEvent } from "react";
import { formatDate, formatYen } from "@/lib/format";
import { StatusBadge } from "@/components/StatusBadge";

type ExpenseItem = {
  id: string;
  description: string;
  amount: number;
  expenseDate: string;
  account: { code: string; name: string } | null;
  vendor: { name: string } | null;
  aiExtraction: { confidence: number; status: string } | null;
};

type ExpenseReport = {
  id: string;
  status: string;
  totalAmount: number;
  createdAt: string;
  employee: { name: string };
  items: ExpenseItem[];
};

export default function ExpensesPage() {
  const [reports, setReports] = useState<ExpenseReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadReports() {
    setLoading(true);
    const res = await fetch("/api/expense-reports");
    setReports(await res.json());
    setLoading(false);
  }

  useEffect(() => {
    loadReports();
  }, []);

  async function createReport() {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/expense-reports", { method: "POST" });
      if (!res.ok) throw new Error("作成に失敗しました");
      await loadReports();
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
    } finally {
      setCreating(false);
    }
  }

  async function addItem(reportId: string, formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const form = formEvent.currentTarget;
    const formData = new FormData(form);
    setUploadingFor(reportId);
    setError(null);
    try {
      const res = await fetch(`/api/expense-reports/${reportId}/items`, { method: "POST", body: formData });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "登録に失敗しました");
      form.reset();
      await loadReports();
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
    } finally {
      setUploadingFor(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">経費精算</h1>
          <p className="mt-1 text-sm text-slate-600">
            レシート画像をアップロードすると、AIが勘定科目・金額を読み取り、信頼度が高ければ自動で仕訳を記帳します。
          </p>
        </div>
        <button
          onClick={createReport}
          disabled={creating}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {creating ? "作成中..." : "新しい経費精算を作成"}
        </button>
      </div>

      {error && <div className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</div>}

      {loading && <p className="text-sm text-slate-500">読み込み中...</p>}

      <div className="space-y-6">
        {reports.map((report) => (
          <div key={report.id} className="rounded-lg border bg-white p-4">
            <div className="flex items-center justify-between">
              <div>
                <span className="font-medium">{report.employee.name}さんの経費精算</span>
                <span className="ml-2 text-xs text-slate-400">{formatDate(report.createdAt)}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold">{formatYen(report.totalAmount)}</span>
                <StatusBadge status={report.status} />
              </div>
            </div>

            {report.items.length > 0 && (
              <table className="mt-3 w-full text-sm">
                <thead className="text-left text-xs uppercase text-slate-400">
                  <tr>
                    <th className="py-1">日付</th>
                    <th className="py-1">内容</th>
                    <th className="py-1">取引先</th>
                    <th className="py-1">勘定科目</th>
                    <th className="py-1">金額</th>
                    <th className="py-1">AI信頼度</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {report.items.map((item) => (
                    <tr key={item.id}>
                      <td className="py-1 whitespace-nowrap">{formatDate(item.expenseDate)}</td>
                      <td className="py-1">{item.description}</td>
                      <td className="py-1">{item.vendor?.name ?? "-"}</td>
                      <td className="py-1 whitespace-nowrap">
                        {item.account ? `${item.account.code} ${item.account.name}` : "-"}
                      </td>
                      <td className="py-1 whitespace-nowrap">{formatYen(item.amount)}</td>
                      <td className="py-1">
                        {item.aiExtraction ? `${(item.aiExtraction.confidence * 100).toFixed(0)}%` : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <form onSubmit={(e) => addItem(report.id, e)} className="mt-4 flex flex-wrap items-end gap-3 border-t pt-3">
              <div>
                <label className="block text-xs text-slate-500">レシート画像</label>
                <input type="file" name="receipt" accept="image/*" required className="text-sm" />
              </div>
              <div>
                <label className="block text-xs text-slate-500">金額(任意・上書き)</label>
                <input type="number" name="amount" className="w-28 rounded border px-2 py-1 text-sm" />
              </div>
              <button
                type="submit"
                disabled={uploadingFor === report.id}
                className="rounded-md bg-slate-700 px-3 py-1.5 text-sm text-white disabled:opacity-50"
              >
                {uploadingFor === report.id ? "AI解析中..." : "レシートを追加"}
              </button>
            </form>
          </div>
        ))}
      </div>
    </div>
  );
}

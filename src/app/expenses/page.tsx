"use client";

import { useEffect, useState, type FormEvent } from "react";
import { formatDate, formatYen } from "@/lib/format";
import { StatusBadge } from "@/components/StatusBadge";
import { PrintButton } from "@/components/PrintButton";

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
  reimbursedAt: string | null;
  approvalStatus: "DRAFT" | "SUBMITTED" | "APPROVED" | "RETURNED";
  approvedByName: string | null;
  returnComment: string | null;
  employee: { name: string };
  items: ExpenseItem[];
};

const APPROVAL_BADGE: Record<ExpenseReport["approvalStatus"], { label: string; className: string } | null> = {
  DRAFT: { label: "未申請", className: "bg-slate-100 text-slate-600" },
  SUBMITTED: { label: "申請中", className: "bg-sky-100 text-sky-800" },
  APPROVED: { label: "承認済み", className: "bg-indigo-100 text-indigo-800" },
  RETURNED: { label: "差戻し", className: "bg-rose-100 text-rose-700" },
};

export default function ExpensesPage() {
  const [reports, setReports] = useState<ExpenseReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [approvalRequired, setApprovalRequired] = useState(false);
  const [limit, setLimit] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState<string | null>(null);

  async function loadReports() {
    const [res, setting] = await Promise.all([fetch("/api/expense-reports"), fetch("/api/expense-reports/approval-setting")]);
    setReports(await res.json());
    if (setting.ok) {
      const body = await setting.json();
      setApprovalRequired(body.required === true);
      setLimit(typeof body.limit === "number" ? body.limit : null);
    }
    setLoading(false);
  }

  async function submitReport(id: string) {
    setSubmitting(id);
    setError(null);
    const res = await fetch(`/api/expense-reports/${id}/submit`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setSubmitting(null);
    if (!res.ok) setError(body.error || "申請できませんでした");
    await loadReports();
  }

  useEffect(() => {
    // Fetch-on-mount: the resulting setState always lands after the fetch's
    // await, so the extra render this rule warns about never happens here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-2xl font-semibold">経費精算</h1>
            <PrintButton variant="outline" />
          </div>
          <p className="mt-1 text-sm text-slate-600">
            レシート画像をアップロードすると、AIが勘定科目・金額を読み取り、信頼度が高ければ自動で仕訳を記帳します。
          </p>
        </div>
        <button
          onClick={createReport}
          disabled={creating}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
        >
          {creating ? "作成中..." : "新しい経費精算を作成"}
        </button>
      </div>

      {error && <div className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</div>}

      {loading && <p className="text-sm text-slate-500">読み込み中...</p>}

      <div className="space-y-6">
        {reports.map((report) => (
          <div key={report.id} className="rounded-xl border border-slate-200 bg-white shadow-sm p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="font-medium">{report.employee.name}さんの経費精算</span>
                <span className="ml-2 text-xs text-slate-400">{formatDate(report.createdAt)}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold">{formatYen(report.totalAmount)}</span>
                {/* 承認フローを使う会社では、申請・承認の状態だけを出す(記帳の状態と紛らわしいため) */}
                {!approvalRequired && <StatusBadge status={report.status} />}
                <a href={`/expenses/${report.id}/print`} className="text-xs whitespace-nowrap text-indigo-700 hover:underline print:hidden">
                  精算書を印刷
                </a>
                {report.reimbursedAt && (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-emerald-800">精算済み</span>
                )}
                {approvalRequired && !report.reimbursedAt && APPROVAL_BADGE[report.approvalStatus] && (
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${APPROVAL_BADGE[report.approvalStatus]!.className}`}>
                    {APPROVAL_BADGE[report.approvalStatus]!.label}
                  </span>
                )}
              </div>
            </div>
            {report.approvalStatus === "RETURNED" && report.returnComment && !report.reimbursedAt && (
              <p className="mt-2 rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-800">差戻しの理由: {report.returnComment}</p>
            )}
            {report.approvalStatus === "APPROVED" && report.approvedByName && !report.reimbursedAt && (
              <p className="mt-2 text-xs text-slate-500">{report.approvedByName}さんが承認しました。精算(支払)をお待ちください。</p>
            )}

            {report.items.length > 0 && (
              <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs whitespace-nowrap uppercase text-slate-400">
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
                      <td className="min-w-[10rem] py-1 pr-3">{item.description}</td>
                      <td className="py-1 whitespace-nowrap">{item.vendor?.name ?? "-"}</td>
                      <td className="py-1 whitespace-nowrap">
                        {item.account ? `${item.account.code} ${item.account.name}` : "-"}
                      </td>
                      <td className="py-1 whitespace-nowrap">
                        {formatYen(item.amount)}
                        {limit !== null && item.amount > limit && <span className="ml-1 rounded bg-amber-100 px-1 text-[11px] font-medium text-amber-800">上限超え</span>}
                      </td>
                      <td className="py-1">
                        {item.aiExtraction ? `${(item.aiExtraction.confidence * 100).toFixed(0)}%` : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}

            {approvalRequired && !report.reimbursedAt && (report.approvalStatus === "DRAFT" || report.approvalStatus === "RETURNED") && report.items.length > 0 && (
              <div className="mt-3 flex items-center justify-end gap-3">
                <span className="text-xs text-slate-500">レシートがそろったら申請してください</span>
                <button
                  onClick={() => submitReport(report.id)}
                  disabled={submitting === report.id}
                  className="rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {report.approvalStatus === "RETURNED" ? "もう一度申請する" : "申請する"}
                </button>
              </div>
            )}
            {report.approvalStatus === "SUBMITTED" || report.approvalStatus === "APPROVED" ? (
              !report.reimbursedAt && <p className="mt-4 border-t pt-3 text-xs text-slate-500">申請中・承認済みの経費精算にはレシートを追加できません。</p>
            ) : report.reimbursedAt ? (
              <p className="mt-4 border-t pt-3 text-xs text-slate-500">
                この経費精算は支払済み({formatDate(report.reimbursedAt)})です。新しいレシートは新しい経費精算に追加してください。
              </p>
            ) : (
              <form onSubmit={(e) => addItem(report.id, e)} className="mt-4 flex flex-wrap items-end gap-3 border-t pt-3 print:hidden">
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
                  className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {uploadingFor === report.id ? "AI解析中..." : "レシートを追加"}
                </button>
              </form>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

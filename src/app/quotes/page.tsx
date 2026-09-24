import Link from "next/link";
import { requireCompanyId } from "@/lib/auth/session";
import { listQuotes } from "@/lib/accounting/quotes";
import { formatDate, formatYen } from "@/lib/format";
import { jstDateKey } from "@/lib/jst";

export const dynamic = "force-dynamic";

const STATUS = {
  OPEN: { label: "提出済み", className: "bg-sky-100 text-sky-800" },
  INVOICED: { label: "請求済み", className: "bg-emerald-100 text-emerald-800" },
  CANCELLED: { label: "取消", className: "bg-slate-100 text-slate-500" },
} as const;

export default async function QuotesPage() {
  const companyId = await requireCompanyId();
  const quotes = await listQuotes(companyId);
  const today = jstDateKey(new Date());

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">見積書</h1>
          <p className="mt-1 text-sm text-slate-600">
            見積書を作って印刷・PDF保存できます。受注したら「請求書にする」で、同じ内容の請求書を作れます(売上の仕訳も自動)。
          </p>
        </div>
        <Link
          href="/quotes/new"
          className="self-start rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium whitespace-nowrap text-white shadow-sm hover:bg-indigo-700"
        >
          + 見積書を作成
        </Link>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs whitespace-nowrap text-slate-500">
              <tr>
                <th className="px-4 py-2">見積番号</th>
                <th className="px-4 py-2">見積先</th>
                <th className="px-4 py-2">見積日</th>
                <th className="px-4 py-2">有効期限</th>
                <th className="px-4 py-2 text-right">金額(税込)</th>
                <th className="px-4 py-2">状態</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {quotes.map((q) => {
                const expired = q.status === "OPEN" && q.validUntil.toISOString().slice(0, 10) < today;
                return (
                  <tr key={q.id}>
                    <td className="px-4 py-2 whitespace-nowrap">
                      <Link href={`/quotes/${q.id}`} className="text-indigo-700 hover:underline">
                        {q.quoteNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">{q.customer.name}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{formatDate(q.issueDate)}</td>
                    <td className={`px-4 py-2 whitespace-nowrap ${expired ? "text-rose-600" : ""}`}>
                      {formatDate(q.validUntil)}
                      {expired && " (期限切れ)"}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap">{formatYen(q.totalAmount)}</td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS[q.status].className}`}>{STATUS[q.status].label}</span>
                      {q.invoice && (
                        <Link href={`/invoices/${q.invoice.id}/print`} className="ml-2 text-xs text-indigo-700 hover:underline">
                          {q.invoice.invoiceNumber}
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}
              {quotes.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                    まだ見積書がありません。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

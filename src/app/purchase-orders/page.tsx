import Link from "next/link";
import { requireCompanyId } from "@/lib/auth/session";
import { listPurchaseOrders } from "@/lib/accounting/purchaseOrders";
import { formatDate, formatYen } from "@/lib/format";
import { jstDateKey } from "@/lib/jst";

export const dynamic = "force-dynamic";

const ORDER_STATUS = {
  OPEN: { label: "発注済み", className: "bg-sky-100 text-sky-800" },
  RECEIVED: { label: "検収済み", className: "bg-emerald-100 text-emerald-800" },
  CANCELLED: { label: "取消", className: "bg-slate-100 text-slate-500" },
} as const;

export default async function PurchaseOrdersPage() {
  const companyId = await requireCompanyId();
  const orders = await listPurchaseOrders(companyId);
  const today = jstDateKey(new Date());
  const open = orders.filter((o) => o.status === "OPEN");
  const late = open.filter((o) => jstDateKey(o.deliveryDate) < today);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">発注書</h1>
          <p className="mt-1 text-sm text-slate-600">
            仕入先・外注先への発注書を作って印刷・PDF保存できます。納品を受けたら「検収する」で買掛金を計上し、支払・振込データにつながります。
          </p>
        </div>
        <Link
          href="/purchase-orders/new"
          className="self-start rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium whitespace-nowrap text-white shadow-sm hover:bg-indigo-700"
        >
          + 発注書を作成
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-500">納品待ち</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{open.length}件</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-500">納品待ちの金額(税込)</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{formatYen(open.reduce((s, o) => s + o.totalAmount, 0))}</p>
        </div>
        <div className={`rounded-xl border p-4 shadow-sm ${late.length ? "border-rose-200 bg-rose-50" : "border-slate-200 bg-white"}`}>
          <p className="text-xs text-slate-500">納期を過ぎた発注</p>
          <p className={`mt-1 text-xl font-semibold tabular-nums ${late.length ? "text-rose-700" : ""}`}>{late.length}件</p>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs whitespace-nowrap text-slate-500">
              <tr>
                <th className="px-4 py-2">発注番号</th>
                <th className="px-4 py-2">発注先</th>
                <th className="px-4 py-2">発注日</th>
                <th className="px-4 py-2">納期</th>
                <th className="px-4 py-2 text-right">金額(税込)</th>
                <th className="px-4 py-2">状態</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {orders.map((o) => {
                const overdue = o.status === "OPEN" && jstDateKey(o.deliveryDate) < today;
                return (
                  <tr key={o.id}>
                    <td className="px-4 py-2 whitespace-nowrap">
                      <Link href={`/purchase-orders/${o.id}`} className="text-indigo-700 hover:underline">
                        {o.orderNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      <Link href={`/vendors/vendor/${o.vendor.id}`} className="hover:underline">
                        {o.vendor.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">{formatDate(o.issueDate)}</td>
                    <td className={`px-4 py-2 whitespace-nowrap ${overdue ? "text-rose-600" : ""}`}>
                      {formatDate(o.deliveryDate)}
                      {overdue && " (納期遅れ)"}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap">{formatYen(o.totalAmount)}</td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ORDER_STATUS[o.status].className}`}>{ORDER_STATUS[o.status].label}</span>
                    </td>
                  </tr>
                );
              })}
              {orders.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                    まだ発注書がありません。
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

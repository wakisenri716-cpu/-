import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCompanyId } from "@/lib/auth/session";
import { getPurchaseOrder, RECEIVE_ACCOUNTS } from "@/lib/accounting/purchaseOrders";
import { listActiveProjects } from "@/lib/accounting/projects";
import { BillingDocument } from "@/components/BillingDocument";
import { PurchaseOrderActions } from "@/components/PurchaseOrderActions";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function PurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  const [data, projects] = await Promise.all([getPurchaseOrder(companyId, id), listActiveProjects(companyId)]);
  if (!data) notFound();
  const { order, calc } = data;
  const paid = order.invoice?.payments.reduce((s, p) => s + p.amount, 0) ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <Link href="/purchase-orders" className="text-sm text-indigo-700 hover:underline">
          ← 発注書一覧
        </Link>
        <div className="flex-1">
          <PurchaseOrderActions orderId={order.id} status={order.status} accounts={RECEIVE_ACCOUNTS} defaultAccountCode={data.defaultAccountCode} canUndo={paid === 0} projects={projects} />
        </div>
      </div>

      {order.status === "RECEIVED" && order.invoice && (
        <div className="rounded-md bg-emerald-50 px-4 py-2 text-sm text-emerald-800 print:hidden">
          {order.receivedDate && `${formatDate(order.receivedDate)}に`}検収して、買掛金を計上しました(請求書番号 {order.invoice.invoiceNumber}
          {order.invoice.dueDate && ` ・ 支払期日 ${formatDate(order.invoice.dueDate)}`})。支払は「
          <Link href="/receivables?type=payable" className="font-medium underline">
            売掛金・買掛金
          </Link>
          」「
          <Link href="/transfers" className="font-medium underline">
            振込データ
          </Link>
          」から。
        </div>
      )}
      {order.status === "CANCELLED" && <div className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-700 print:hidden">この発注書は取り消されています。</div>}

      <BillingDocument
        kind="order"
        number={order.orderNumber}
        issueDate={order.issueDate}
        deadline={order.deliveryDate}
        customerName={order.vendor.name}
        company={order.company}
        lines={order.lines}
        calc={calc}
        notes={order.notes}
        terms={[
          { label: "納品場所", value: order.deliveryPlace },
          { label: "お支払条件", value: order.paymentTerms },
        ]}
      />
    </div>
  );
}

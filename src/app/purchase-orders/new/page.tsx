import { requireCompanyId } from "@/lib/auth/session";
import { toFormLines } from "@/lib/accounting/issueInvoice";
import { getPurchaseOrder } from "@/lib/accounting/purchaseOrders";
import { BillingForm } from "@/components/BillingForm";

export const dynamic = "force-dynamic";

export default async function NewPurchaseOrderPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const companyId = await requireCompanyId();
  const { from } = await searchParams;
  const source = from ? await getPurchaseOrder(companyId, from) : null;
  const initial = source
    ? {
        customerName: source.order.vendor.name,
        lines: toFormLines(source.order.lines),
        notes: source.order.notes ?? "",
        deliveryPlace: source.order.deliveryPlace ?? "",
        paymentTerms: source.order.paymentTerms ?? "",
      }
    : null;
  return <BillingForm kind="order" initial={initial} />;
}

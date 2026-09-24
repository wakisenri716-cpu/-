import { requireCompanyId } from "@/lib/auth/session";
import { getPrintableInvoice, toFormLines } from "@/lib/accounting/issueInvoice";
import { BillingForm } from "@/components/BillingForm";

export const dynamic = "force-dynamic";

// ?from=請求書ID で、その請求書の宛先・明細を写した状態から作り始める(毎月同じ請求の複製)
export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const companyId = await requireCompanyId();
  const { from } = await searchParams;
  const source = from ? await getPrintableInvoice(companyId, from) : null;
  const initial = source
    ? { customerName: source.invoice.customer?.name ?? "", lines: toFormLines(source.invoice.lines), notes: source.invoice.notes ?? "" }
    : null;
  return <BillingForm kind="invoice" initial={initial} />;
}

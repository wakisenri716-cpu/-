import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCompanyId } from "@/lib/auth/session";
import { getPrintableInvoice } from "@/lib/accounting/issueInvoice";
import { PrintButton } from "@/components/PrintButton";
import { BillingDocument } from "@/components/BillingDocument";

export const dynamic = "force-dynamic";

// 請求書と同じ明細の納品書
export default async function DeliveryNotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  const data = await getPrintableInvoice(companyId, id);
  if (!data) notFound();
  const { invoice, calc } = data;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 print:hidden">
        <Link href={`/invoices/${invoice.id}/print`} className="text-sm text-indigo-700 hover:underline">
          ← 請求書に戻る
        </Link>
        <PrintButton />
      </div>
      <BillingDocument
        kind="delivery"
        number={invoice.invoiceNumber ?? ""}
        issueDate={invoice.issueDate ?? invoice.createdAt}
        deadline={null}
        customerName={invoice.customer?.name ?? ""}
        company={invoice.company}
        lines={invoice.lines}
        calc={calc}
        notes={invoice.notes}
      />
    </div>
  );
}

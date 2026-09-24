import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCompanyId } from "@/lib/auth/session";
import { getQuote } from "@/lib/accounting/quotes";
import { BillingDocument } from "@/components/BillingDocument";
import { QuoteActions } from "@/components/QuoteActions";

export const dynamic = "force-dynamic";

export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  const data = await getQuote(companyId, id);
  if (!data) notFound();
  const { quote, calc } = data;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <Link href="/quotes" className="text-sm text-indigo-700 hover:underline">
          ← 見積書一覧
        </Link>
        <div className="flex-1">
          <QuoteActions quoteId={quote.id} status={quote.status} />
        </div>
      </div>

      {quote.status === "INVOICED" && quote.invoice && (
        <div className="rounded-md bg-emerald-50 px-4 py-2 text-sm text-emerald-800 print:hidden">
          請求書にしました:{" "}
          <Link href={`/invoices/${quote.invoice.id}/print`} className="font-medium underline">
            {quote.invoice.invoiceNumber}
          </Link>
        </div>
      )}
      {quote.status === "CANCELLED" && (
        <div className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-700 print:hidden">この見積書は取り消されています。</div>
      )}

      <BillingDocument
        kind="quote"
        number={quote.quoteNumber}
        issueDate={quote.issueDate}
        deadline={quote.validUntil}
        customerName={quote.customer.name}
        company={quote.company}
        lines={quote.lines}
        calc={calc}
        notes={quote.notes}
      />
    </div>
  );
}

import { requireCompanyId } from "@/lib/auth/session";
import { toFormLines } from "@/lib/accounting/issueInvoice";
import { getQuote } from "@/lib/accounting/quotes";
import { BillingForm } from "@/components/BillingForm";

export const dynamic = "force-dynamic";

export default async function NewQuotePage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const companyId = await requireCompanyId();
  const { from } = await searchParams;
  const source = from ? await getQuote(companyId, from) : null;
  const initial = source
    ? { customerName: source.quote.customer.name, lines: toFormLines(source.quote.lines), notes: source.quote.notes ?? "" }
    : null;
  return <BillingForm kind="quote" initial={initial} />;
}

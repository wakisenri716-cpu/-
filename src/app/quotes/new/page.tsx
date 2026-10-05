import { requireCompanyId } from "@/lib/auth/session";
import { toFormLines } from "@/lib/accounting/issueInvoice";
import { getQuote } from "@/lib/accounting/quotes";
import { BillingForm } from "@/components/BillingForm";
import { getQuoteDraft } from "@/lib/quoteAssist";

export const dynamic = "force-dynamic";

export default async function NewQuotePage({ searchParams }: { searchParams: Promise<{ from?: string; customer?: string; draft?: string }> }) {
  const companyId = await requireCompanyId();
  const { from, customer, draft } = await searchParams;
  const source = from ? await getQuote(companyId, from) : null;
  // AI見積アシストで作った下書き
  const aiDraft = draft ? await getQuoteDraft(companyId, draft) : null;
  const initial = aiDraft
    ? { customerName: aiDraft.customerName, lines: toFormLines(aiDraft.lines), notes: "" }
    : source
    ? { customerName: source.quote.customer.name, lines: toFormLines(source.quote.lines), notes: source.quote.notes ?? "" }
    : customer
      ? // 商談管理の「見積書を作る」から来たときは、顧客を入れておく
        { customerName: customer.slice(0, 100), lines: [], notes: "" }
      : null;
  return <BillingForm kind="quote" initial={initial} />;
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSharedQuote } from "@/lib/documentMail";
import { BillingDocument } from "@/components/BillingDocument";
import { PrintButton } from "@/components/PrintButton";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "見積書", robots: { index: false, follow: false } };

// メールで送った見積書を、受け取った人がログインせずに見る・印刷する画面
export default async function SharedQuotePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const data = await getSharedQuote(token);
  if (!data) notFound();
  const { quote, calc } = data;

  return (
    <div className="space-y-4">
      {quote.status === "CANCELLED" ? (
        <div className="rounded-md bg-rose-50 px-4 py-3 text-sm text-rose-800">この見積書は取り消されました。発行元にお問い合わせください。</div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
            <p className="text-sm text-slate-600">{quote.company.name} からの見積書です。印刷・PDF保存ができます。</p>
            <PrintButton />
          </div>
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
        </>
      )}
    </div>
  );
}

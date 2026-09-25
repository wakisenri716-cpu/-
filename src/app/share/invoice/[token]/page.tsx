import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSharedInvoice } from "@/lib/documentMail";
import { BillingDocument } from "@/components/BillingDocument";
import { PrintButton } from "@/components/PrintButton";

export const dynamic = "force-dynamic";
// 共有リンクは検索エンジンに載せない
export const metadata: Metadata = { title: "請求書", robots: { index: false, follow: false } };

// メールで送った請求書を、受け取った人がログインせずに見る・印刷する画面
export default async function SharedInvoicePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const data = await getSharedInvoice(token);
  if (!data) notFound();
  const { invoice, calc } = data;

  return (
    <div className="space-y-4">
      {invoice.status === "CANCELLED" ? (
        <div className="rounded-md bg-rose-50 px-4 py-3 text-sm text-rose-800">この請求書は取り消されました。発行元にお問い合わせください。</div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
          <p className="text-sm text-slate-600">{invoice.company.name} からの請求書です。印刷・PDF保存ができます。</p>
          <PrintButton />
        </div>
      )}
      {invoice.status !== "CANCELLED" && (
        <BillingDocument
          kind="invoice"
          number={invoice.invoiceNumber ?? ""}
          issueDate={invoice.issueDate ?? invoice.createdAt}
          deadline={invoice.dueDate}
          customerName={invoice.customer?.name ?? ""}
          company={invoice.company}
          lines={invoice.lines}
          calc={calc}
          notes={invoice.notes}
        />
      )}
    </div>
  );
}

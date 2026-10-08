import Link from "next/link";
import { addressLine, attentionLine } from "@/lib/addressBook";
import { notFound } from "next/navigation";
import { requireCompanyId } from "@/lib/auth/session";
import { getPrintableInvoice } from "@/lib/accounting/issueInvoice";
import { formatYen } from "@/lib/format";
import { jstDateKey } from "@/lib/jst";
import { PrintButton } from "@/components/PrintButton";
import { BillingDocument } from "@/components/BillingDocument";
import { CancelInvoiceButton } from "@/components/CancelInvoiceButton";
import { SendMailButton } from "@/components/SendMailButton";
import { InvoiceCheckPanel } from "@/components/InvoiceCheckPanel";
import { checkInvoice } from "@/lib/invoiceCheck";
import { aiEnabled } from "@/lib/ai/access";

export const dynamic = "force-dynamic";

export default async function InvoicePrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  const data = await getPrintableInvoice(companyId, id);
  if (!data) notFound();
  const { invoice, calc } = data;
  const company = invoice.company;
  const paid = invoice.payments.reduce((s, p) => s + p.amount, 0);
  const cancelled = invoice.status === "CANCELLED";
  const [issues, ai] = cancelled ? [[], false] : await Promise.all([checkInvoice(companyId, id), aiEnabled(companyId)]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/invoices" className="text-sm text-indigo-700 hover:underline">
          ← 請求書一覧
        </Link>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {!company.registrationNumber && (
            <Link href="/company" className="text-xs text-amber-700 hover:underline">
              登録番号が未設定です(会社情報で設定)
            </Link>
          )}
          {!cancelled && calc.total - paid > 0 && invoice.dueDate && invoice.dueDate.toISOString().slice(0, 10) < jstDateKey(new Date()) && (
            <>
              <Link href={`/invoices/${invoice.id}/reminder`} className="rounded-md border border-amber-300 px-3 py-2 text-sm text-amber-800 hover:bg-amber-50">
                督促状を作成
              </Link>
              <SendMailButton kind="reminder" id={invoice.id} tone="warning" />
            </>
          )}
          {!cancelled && <SendMailButton kind="invoice" id={invoice.id} />}
          {!cancelled && invoice.customer && (
            <Link
              href={`/letters/cover?kind=customer&id=${invoice.customer.id}&items=${encodeURIComponent(`請求書(${invoice.invoiceNumber}) 1通`)}`}
              className="rounded-md border px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              送付状
            </Link>
          )}
          {!cancelled && (
            <Link href={`/invoices/${invoice.id}/delivery`} className="rounded-md border px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
              納品書
            </Link>
          )}
          {invoice.status === "PAID" && (
            <Link href={`/invoices/${invoice.id}/receipt`} className="rounded-md border border-emerald-300 px-3 py-2 text-sm text-emerald-800 hover:bg-emerald-50">
              領収書
            </Link>
          )}
          {!cancelled && (
            <Link href={`/recurring-invoices?template=${invoice.id}`} className="rounded-md border px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
              毎月の定期請求にする
            </Link>
          )}
          <Link href={`/invoices/new?from=${invoice.id}`} className="rounded-md border px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
            複製して作成
          </Link>
          {!cancelled && (
            <Link href={`/invoices/new?correct=${invoice.id}`} className="rounded-md border px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
              訂正する
            </Link>
          )}
          {!cancelled && paid === 0 && <CancelInvoiceButton invoiceId={invoice.id} />}
          {!cancelled && invoice.status !== "DRAFT" && (
            // デジタルインボイス(Peppol / JP PINT の XML)。Peppol で送るときは、この XML をアクセスポイント事業者のサービスに渡す
            <a href={`/api/invoices/${invoice.id}/peppol`} download className="rounded-md border border-indigo-300 px-3 py-2 text-sm text-indigo-700 hover:bg-indigo-50" title="Peppol(JP PINT)形式の XML">
              デジタルインボイス(XML)
            </a>
          )}
          {!cancelled && <PrintButton />}
        </div>
      </div>

      {cancelled && (
        <div className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-700 print:hidden">
          {invoice.correctedBy ? (
            <>
              この請求書は訂正されました(売上の仕訳も取り消し済み)。訂正版:{" "}
              <Link href={`/invoices/${invoice.correctedBy.id}/print`} className="font-medium underline">
                {invoice.correctedBy.invoiceNumber}
              </Link>
            </>
          ) : (
            "この請求書は取り消されています(売上の仕訳も取り消し済み)。"
          )}
        </div>
      )}

      {!cancelled && <InvoiceCheckPanel id={invoice.id} issues={issues} ai={ai} />}

      <BillingDocument
        kind="invoice"
        number={invoice.invoiceNumber ?? ""}
        issueDate={invoice.issueDate ?? invoice.createdAt}
        deadline={invoice.dueDate}
        customerName={invoice.customer?.name ?? ""}
        customerAddress={addressLine(invoice.customer)}
        customerAttention={attentionLine(invoice.customer)}
        company={company}
        lines={invoice.lines}
        calc={calc}
        notes={invoice.notes}
        correction={
          invoice.correctsInvoice
            ? { originalNumber: invoice.correctsInvoice.invoiceNumber ?? "", originalDate: invoice.correctsInvoice.issueDate, reason: invoice.correctionReason }
            : null
        }
      />

      {paid > 0 && (
        <p className="text-center text-xs text-slate-500 print:hidden">
          入金済み {formatYen(paid)} / 残り {formatYen(calc.total - paid)}
        </p>
      )}
    </div>
  );
}

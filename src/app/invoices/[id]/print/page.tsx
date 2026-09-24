import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCompanyId } from "@/lib/auth/session";
import { getPrintableInvoice } from "@/lib/accounting/issueInvoice";
import { formatYen } from "@/lib/format";
import { PrintButton } from "@/components/PrintButton";
import { CancelInvoiceButton } from "@/components/CancelInvoiceButton";

export const dynamic = "force-dynamic";

function jpDate(d: Date | null) {
  if (!d) return "";
  return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
}

export default async function InvoicePrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  const data = await getPrintableInvoice(companyId, id);
  if (!data) notFound();
  const { invoice, calc } = data;
  const company = invoice.company;
  const paid = invoice.payments.reduce((s, p) => s + p.amount, 0);
  const cancelled = invoice.status === "CANCELLED";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/invoices" className="text-sm text-indigo-700 hover:underline">
          ← 請求書一覧
        </Link>
        <div className="flex items-center gap-3">
          {!company.registrationNumber && (
            <Link href="/company" className="text-xs text-amber-700 hover:underline">
              登録番号が未設定です(会社情報で設定)
            </Link>
          )}
          {!cancelled && paid === 0 && <CancelInvoiceButton invoiceId={invoice.id} />}
          {!cancelled && <PrintButton />}
        </div>
      </div>

      {cancelled && (
        <div className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-700 print:hidden">
          この請求書は取り消されています(売上の仕訳も取り消し済み)。
        </div>
      )}

      <article className="mx-auto max-w-[210mm] bg-white p-5 text-[13px] leading-relaxed text-slate-900 shadow-sm ring-1 ring-slate-200 sm:p-12 print:max-w-none print:p-0 print:shadow-none print:ring-0">
        <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <h1 className="text-2xl font-bold tracking-[0.3em] whitespace-nowrap sm:text-3xl">請求書</h1>
          <dl className="text-right text-xs whitespace-nowrap">
            <div>
              <dt className="inline text-slate-500">請求番号 </dt>
              <dd className="inline">{invoice.invoiceNumber}</dd>
            </div>
            <div>
              <dt className="inline text-slate-500">請求日 </dt>
              <dd className="inline">{jpDate(invoice.issueDate)}</dd>
            </div>
          </dl>
        </header>

        <section className="mt-8 flex flex-col gap-6 sm:flex-row sm:justify-between print:flex-row print:justify-between">
          <div>
            <p className="border-b border-slate-400 pb-1 text-lg font-semibold">{invoice.customer?.name} 御中</p>
            <p className="mt-4">下記のとおりご請求申し上げます。</p>
            <div className="mt-3 inline-flex items-baseline gap-4 border-b-2 border-slate-900 pb-1">
              <span className="text-sm">ご請求金額(税込)</span>
              <span className="text-2xl font-bold tabular-nums">{formatYen(calc.total)}</span>
            </div>
            <p className="mt-2 text-xs">お支払期限: {jpDate(invoice.dueDate)}</p>
          </div>
          <div className="text-xs sm:text-right print:text-right">
            <p className="text-sm font-semibold">{company.name}</p>
            {company.address && <p className="whitespace-pre-line">{company.address}</p>}
            {company.phone && <p>TEL: {company.phone}</p>}
            {company.registrationNumber && <p>登録番号: {company.registrationNumber}</p>}
          </div>
        </section>

        <table className="mt-8 w-full border-collapse text-xs">
          <thead>
            <tr className="border-y border-slate-400 bg-slate-50 print:bg-slate-100">
              <th className="px-2 py-1.5 text-left font-medium">品目</th>
              <th className="px-2 py-1.5 text-right font-medium">数量</th>
              <th className="px-2 py-1.5 text-right font-medium">単価</th>
              <th className="px-2 py-1.5 text-right font-medium whitespace-nowrap">金額(税抜)</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((l) => (
              <tr key={l.id} className="border-b border-slate-200">
                <td className="px-2 py-1.5">
                  {l.description}
                  {l.taxRate === 8 && <span className="ml-1 text-slate-500">※</span>}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">
                  {l.quantity.toLocaleString("ja-JP")}
                  {l.unit ?? ""}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">{formatYen(l.unitPrice)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">{formatYen(l.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-4 flex justify-end">
          <dl className="w-full max-w-xs text-xs">
            <div className="flex justify-between py-0.5">
              <dt>小計(税抜)</dt>
              <dd className="tabular-nums">{formatYen(calc.subtotal)}</dd>
            </div>
            {calc.byRate.map((r) => (
              <div key={r.rate} className="flex justify-between py-0.5 text-slate-700">
                <dt>
                  {r.rate}%対象 {formatYen(r.base)} / 消費税
                </dt>
                <dd className="tabular-nums">{formatYen(r.tax)}</dd>
              </div>
            ))}
            <div className="mt-1 flex justify-between border-t border-slate-900 pt-1 text-sm font-bold">
              <dt>合計(税込)</dt>
              <dd className="tabular-nums">{formatYen(calc.total)}</dd>
            </div>
          </dl>
        </div>
        {invoice.lines.some((l) => l.taxRate === 8) && <p className="mt-2 text-xs text-slate-600">※は軽減税率(8%)対象です。</p>}

        {(company.bankAccount || invoice.notes || company.invoiceNote) && (
          <section className="mt-8 space-y-3 text-xs">
            {company.bankAccount && (
              <div>
                <p className="font-semibold">お振込先</p>
                <p className="whitespace-pre-line">{company.bankAccount}</p>
              </div>
            )}
            {(invoice.notes || company.invoiceNote) && (
              <div>
                <p className="font-semibold">備考</p>
                <p className="whitespace-pre-line">{[invoice.notes, company.invoiceNote].filter(Boolean).join("\n")}</p>
              </div>
            )}
          </section>
        )}
      </article>

      {paid > 0 && (
        <p className="text-center text-xs text-slate-500 print:hidden">
          入金済み {formatYen(paid)} / 残り {formatYen(calc.total - paid)}
        </p>
      )}
    </div>
  );
}

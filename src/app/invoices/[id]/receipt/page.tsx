import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCompanyId } from "@/lib/auth/session";
import { getPrintableInvoice } from "@/lib/accounting/issueInvoice";
import { formatYen } from "@/lib/format";
import { PrintButton } from "@/components/PrintButton";
import { jpDate } from "@/components/BillingDocument";

export const dynamic = "force-dynamic";

// 全額入金された請求書の領収書(適格簡易請求書の記載事項: 発行者・登録番号・日付・内容・税率ごとの金額と消費税)
export default async function ReceiptPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ note?: string }> }) {
  const { id } = await params;
  const { note } = await searchParams;
  const companyId = await requireCompanyId();
  const data = await getPrintableInvoice(companyId, id);
  if (!data) notFound();
  const { invoice, calc } = data;
  const company = invoice.company;
  const paid = invoice.payments.reduce((s, p) => s + p.amount, 0);
  const lastPayment = invoice.payments.reduce<Date | null>((d, p) => (!d || p.paymentDate > d ? p.paymentDate : d), null);
  const fullyPaid = invoice.status === "PAID" && paid >= calc.total;
  const purpose = (note ?? "").trim().slice(0, 40) || (invoice.lines.length === 1 ? invoice.lines[0].description : `${invoice.lines[0].description} ほか`);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <Link href={`/invoices/${invoice.id}/print`} className="text-sm text-indigo-700 hover:underline">
          ← 請求書に戻る
        </Link>
        {fullyPaid && (
          <form method="get" className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-slate-500">
              但し書き(〇〇代として)
              <input name="note" defaultValue={purpose} maxLength={40} className="mt-1 block w-56 rounded-md border px-2 py-1.5 text-sm text-slate-900" />
            </label>
            <button type="submit" className="rounded-md border px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
              反映
            </button>
            <PrintButton />
          </form>
        )}
      </div>

      {!fullyPaid ? (
        <div className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-900">
          領収書は、全額の入金を記録した請求書だけ発行できます(入金済み {formatYen(paid)} / 請求額 {formatYen(calc.total)})。
        </div>
      ) : (
        <article className="mx-auto max-w-[210mm] bg-white p-5 text-[13px] leading-relaxed text-slate-900 shadow-sm ring-1 ring-slate-200 sm:p-12 print:max-w-none print:p-0 print:shadow-none print:ring-0">
          <header className="flex flex-wrap items-start justify-between gap-3">
            <h1 className="text-3xl font-bold tracking-[0.4em]">領収書</h1>
            <dl className="text-right text-xs whitespace-nowrap">
              <div>
                <dt className="inline text-slate-500">No. </dt>
                <dd className="inline">{invoice.invoiceNumber}</dd>
              </div>
              <div>
                <dt className="inline text-slate-500">発行日 </dt>
                <dd className="inline">{jpDate(lastPayment)}</dd>
              </div>
            </dl>
          </header>

          <p className="mt-8 inline-block min-w-[16rem] border-b border-slate-400 pb-1 text-lg font-semibold">{invoice.customer?.name} 様</p>

          <div className="mx-auto mt-8 max-w-md border-y-2 border-slate-900 py-3 text-center">
            <span className="text-3xl font-bold tracking-wider tabular-nums">{formatYen(calc.total)}-</span>
            <span className="ml-2 text-sm">(税込)</span>
          </div>
          <p className="mt-4 text-center">但し {purpose} 代として、上記正に領収いたしました。</p>

          <div className="mt-8 flex flex-col gap-6 sm:flex-row sm:justify-between print:flex-row print:justify-between">
            <table className="text-xs">
              <caption className="mb-1 text-left font-semibold text-slate-600">内訳</caption>
              <tbody>
                {calc.byRate.map((r) => (
                  <tr key={r.rate}>
                    <th className="pr-4 text-left font-normal">
                      {r.rate}%対象{r.rate === 8 && "(軽減税率)"}
                    </th>
                    <td className="pr-3 text-right tabular-nums">{formatYen(r.base + r.tax)}</td>
                    <td className="text-right text-slate-600 tabular-nums">(うち消費税 {formatYen(r.tax)})</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="text-xs sm:text-right print:text-right">
              <p className="text-sm font-semibold">{company.name}</p>
              {company.address && <p className="whitespace-pre-line">{company.address}</p>}
              {company.phone && <p>TEL: {company.phone}</p>}
              {company.registrationNumber && <p>登録番号: {company.registrationNumber}</p>}
            </div>
          </div>

          {calc.subtotal >= 50_000 && (
            <p className="mt-8 text-[11px] text-slate-500 print:hidden">
              ※ 紙で渡す場合、税抜金額が5万円以上の領収書には収入印紙が必要です(PDFをメールなどで送る場合は不要です)。
            </p>
          )}
        </article>
      )}
    </div>
  );
}

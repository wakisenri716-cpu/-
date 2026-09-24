import { formatYen } from "@/lib/format";
import type { calcInvoice } from "@/lib/accounting/issueInvoice";

type Line = { id: string; description: string; quantity: number; unit: string | null; unitPrice: number; taxRate: number; amount: number };
type Company = { name: string; address: string | null; phone: string | null; registrationNumber: string | null; bankAccount: string | null; invoiceNote: string | null };

export function jpDate(d: Date | null) {
  if (!d) return "";
  return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
}

// 請求書・見積書の共通レイアウト(印刷・PDF保存用。A4 1枚に収まる想定)
export function BillingDocument(props: {
  kind: "invoice" | "quote";
  number: string;
  issueDate: Date;
  deadline: Date | null;
  customerName: string;
  company: Company;
  lines: Line[];
  calc: ReturnType<typeof calcInvoice>;
  notes: string | null;
}) {
  const { kind, company, lines, calc } = props;
  const invoice = kind === "invoice";
  const notes = [props.notes, invoice ? company.invoiceNote : null].filter(Boolean).join("\n");

  return (
    <article className="mx-auto max-w-[210mm] bg-white p-5 text-[13px] leading-relaxed text-slate-900 shadow-sm ring-1 ring-slate-200 sm:p-12 print:max-w-none print:p-0 print:shadow-none print:ring-0">
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <h1 className="text-2xl font-bold tracking-[0.3em] whitespace-nowrap sm:text-3xl">{invoice ? "請求書" : "御見積書"}</h1>
        <dl className="text-right text-xs whitespace-nowrap">
          <div>
            <dt className="inline text-slate-500">{invoice ? "請求番号" : "見積番号"} </dt>
            <dd className="inline">{props.number}</dd>
          </div>
          <div>
            <dt className="inline text-slate-500">{invoice ? "請求日" : "見積日"} </dt>
            <dd className="inline">{jpDate(props.issueDate)}</dd>
          </div>
        </dl>
      </header>

      <section className="mt-8 flex flex-col gap-6 sm:flex-row sm:justify-between print:flex-row print:justify-between">
        <div>
          <p className="border-b border-slate-400 pb-1 text-lg font-semibold">{props.customerName} 御中</p>
          <p className="mt-4">{invoice ? "下記のとおりご請求申し上げます。" : "下記のとおりお見積り申し上げます。"}</p>
          <div className="mt-3 inline-flex items-baseline gap-4 border-b-2 border-slate-900 pb-1">
            <span className="text-sm">{invoice ? "ご請求金額(税込)" : "お見積金額(税込)"}</span>
            <span className="text-2xl font-bold tabular-nums">{formatYen(calc.total)}</span>
          </div>
          <p className="mt-2 text-xs">
            {invoice ? "お支払期限" : "有効期限"}: {jpDate(props.deadline)}
          </p>
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
          {lines.map((l) => (
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
      {lines.some((l) => l.taxRate === 8) && <p className="mt-2 text-xs text-slate-600">※は軽減税率(8%)対象です。</p>}

      {((invoice && company.bankAccount) || notes) && (
        <section className="mt-8 space-y-3 text-xs">
          {invoice && company.bankAccount && (
            <div>
              <p className="font-semibold">お振込先</p>
              <p className="whitespace-pre-line">{company.bankAccount}</p>
            </div>
          )}
          {notes && (
            <div>
              <p className="font-semibold">備考</p>
              <p className="whitespace-pre-line">{notes}</p>
            </div>
          )}
        </section>
      )}
    </article>
  );
}

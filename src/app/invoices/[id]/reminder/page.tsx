import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireCompanyId } from "@/lib/auth/session";
import { formatYen } from "@/lib/format";
import { jstDateKey } from "@/lib/jst";
import { PrintButton } from "@/components/PrintButton";

export const dynamic = "force-dynamic";

const OPEN = ["CONFIRMED", "SENT", "PARTIALLY_PAID", "OVERDUE"];

function jp(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return `${y}年${m}月${d}日`;
}

function addDays(key: string, days: number) {
  return new Date(Date.parse(`${key}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

// 入金が遅れている請求書の「お支払いのお願い」(督促状)。印刷・PDF保存して送る。
export default async function ReminderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ by?: string }> }) {
  const { id } = await params;
  const { by } = await searchParams;
  const companyId = await requireCompanyId();
  const invoice = await prisma.invoice.findFirst({
    where: { id, companyId, direction: "ISSUED" },
    include: { customer: true, company: true, payments: { select: { amount: true } } },
  });
  if (!invoice) notFound();
  const today = jstDateKey(new Date());
  const paid = invoice.payments.reduce((s, p) => s + p.amount, 0);
  const remaining = invoice.totalAmount - paid;
  const payBy = by && /^\d{4}-\d{2}-\d{2}$/.test(by) && !Number.isNaN(Date.parse(by)) ? by : addDays(today, 7);
  const company = invoice.company;
  const open = OPEN.includes(invoice.status) && remaining > 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <Link href="/receivables" className="text-sm text-indigo-700 hover:underline">
          ← 売掛金・買掛金
        </Link>
        <form method="get" className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-slate-500">
            お支払いをお願いする期限
            <input type="date" name="by" defaultValue={payBy} className="mt-1 block rounded-md border px-2 py-1.5 text-sm text-slate-900" />
          </label>
          <button type="submit" className="rounded-md border px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
            反映
          </button>
          <PrintButton />
        </form>
      </div>

      {!open && (
        <div className="rounded-md bg-emerald-50 px-4 py-2 text-sm text-emerald-800 print:hidden">この請求書は未入金の残高がありません(督促は不要です)。</div>
      )}

      <article className="mx-auto max-w-[210mm] bg-white p-5 text-[13px] leading-relaxed text-slate-900 shadow-sm ring-1 ring-slate-200 sm:p-12 print:max-w-none print:p-0 print:shadow-none print:ring-0">
        <p className="text-right text-xs">{jp(today)}</p>
        <div className="mt-6 flex flex-col gap-6 sm:flex-row sm:justify-between print:flex-row print:justify-between">
          <p className="border-b border-slate-400 pb-1 text-lg font-semibold">{invoice.customer?.name} 御中</p>
          <div className="text-xs sm:text-right print:text-right">
            <p className="text-sm font-semibold">{company.name}</p>
            {company.address && <p className="whitespace-pre-line">{company.address}</p>}
            {company.phone && <p>TEL: {company.phone}</p>}
          </div>
        </div>

        <h1 className="mt-10 text-center text-xl font-bold tracking-widest">お支払いについてのご確認(お願い)</h1>

        <div className="mt-8 space-y-3">
          <p>拝啓 時下ますますご清祥のこととお喜び申し上げます。平素は格別のお引き立てを賜り、厚く御礼申し上げます。</p>
          <p>
            さて、下記のご請求につきまして、お支払期限を過ぎておりますが、本日現在ご入金の確認ができておりません。
            お手数をおかけしますが、ご確認のうえ、<span className="font-semibold">{jp(payBy)}</span>までにお振込みくださいますようお願い申し上げます。
          </p>
          <p>なお、本状と行き違いにすでにお支払いいただいている場合は、何卒ご容赦ください。</p>
          <p className="text-right">敬具</p>
        </div>

        <p className="mt-8 text-center">記</p>
        <table className="mt-3 w-full border-collapse text-xs">
          <tbody>
            {[
              ["請求書番号", invoice.invoiceNumber ?? "-"],
              ["請求日", invoice.issueDate ? jp(invoice.issueDate.toISOString().slice(0, 10)) : "-"],
              ["当初のお支払期限", invoice.dueDate ? jp(invoice.dueDate.toISOString().slice(0, 10)) : "-"],
              ["ご請求金額", formatYen(invoice.totalAmount)],
              ...(paid > 0 ? [["ご入金済み", formatYen(paid)]] : []),
            ].map(([label, value]) => (
              <tr key={label} className="border-b border-slate-200">
                <th className="w-40 bg-slate-50 px-3 py-2 text-left font-medium print:bg-slate-100">{label}</th>
                <td className="px-3 py-2 tabular-nums">{value}</td>
              </tr>
            ))}
            <tr className="border-b-2 border-slate-900">
              <th className="bg-slate-50 px-3 py-2 text-left font-semibold print:bg-slate-100">未入金額</th>
              <td className="px-3 py-2 text-base font-bold tabular-nums">{formatYen(Math.max(0, remaining))}</td>
            </tr>
          </tbody>
        </table>

        {company.bankAccount && (
          <div className="mt-6 text-xs">
            <p className="font-semibold">お振込先</p>
            <p className="whitespace-pre-line">{company.bankAccount}</p>
          </div>
        )}
        <p className="mt-10 text-right">以上</p>
      </article>
    </div>
  );
}

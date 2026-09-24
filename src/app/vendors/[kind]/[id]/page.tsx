import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCompanyId } from "@/lib/auth/session";
import { getPartyDetail } from "@/lib/parties";
import { formatDate, formatYen } from "@/lib/format";
import { StatusBadge } from "@/components/StatusBadge";

export const dynamic = "force-dynamic";

const QUOTE_STATUS = { OPEN: "提出済み", INVOICED: "請求済み", CANCELLED: "取消" } as const;

function Tile({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className={`rounded-xl border p-4 shadow-sm ${tone ?? "border-slate-200 bg-white"}`}>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

export default async function PartyPage({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  if (kind !== "vendor" && kind !== "customer") notFound();
  const companyId = await requireCompanyId();
  const data = await getPartyDetail(companyId, kind, id);
  if (!data) notFound();
  const customer = kind === "customer";

  return (
    <div className="space-y-6">
      <div>
        <Link href="/vendors" className="text-sm text-indigo-700 hover:underline">
          ← 取引先・顧客
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">{data.party.name}</h1>
        <p className="mt-1 text-sm text-slate-600">
          {customer ? "顧客(売上の相手)" : "取引先(仕入・経費の支払先)"}
          {data.party.defaultAccount && ` ・ 既定の勘定科目: ${data.party.defaultAccount.code} ${data.party.defaultAccount.name}`}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Tile label={customer ? "請求額の合計" : "受け取った請求額の合計"} value={formatYen(data.totals.invoiced)} />
        <Tile label={customer ? "入金済み" : "支払済み"} value={formatYen(data.totals.settled)} />
        <Tile
          label={customer ? "入金待ち" : "支払予定"}
          value={formatYen(data.totals.remaining)}
          tone={data.totals.remaining > 0 ? "border-amber-200 bg-amber-50" : undefined}
        />
      </div>

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold">請求書</h2>
          {customer && (
            <Link href="/invoices/new" className="text-sm text-indigo-700 hover:underline">
              + 請求書を作成
            </Link>
          )}
        </div>
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs whitespace-nowrap text-slate-500">
                <tr>
                  <th className="px-4 py-2">番号</th>
                  <th className="px-4 py-2">請求日</th>
                  <th className="px-4 py-2">期日</th>
                  <th className="px-4 py-2 text-right">金額</th>
                  <th className="px-4 py-2 text-right">残高</th>
                  <th className="px-4 py-2">状態</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.invoices.map((i) => (
                  <tr key={i.id}>
                    <td className="px-4 py-2 whitespace-nowrap">
                      {i.printable ? (
                        <Link href={`/invoices/${i.id}/print`} className="text-indigo-700 hover:underline">
                          {i.invoiceNumber}
                        </Link>
                      ) : (
                        (i.invoiceNumber ?? "-")
                      )}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">{formatDate(i.issueDate)}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{formatDate(i.dueDate)}</td>
                    <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap">{formatYen(i.total)}</td>
                    <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap">{i.remaining ? formatYen(i.remaining) : "-"}</td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      <StatusBadge status={i.status} />
                    </td>
                  </tr>
                ))}
                {data.invoices.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                      まだ請求書はありません。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {customer && data.quotes.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-semibold">見積書</h2>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs whitespace-nowrap text-slate-500">
                  <tr>
                    <th className="px-4 py-2">見積番号</th>
                    <th className="px-4 py-2">見積日</th>
                    <th className="px-4 py-2 text-right">金額</th>
                    <th className="px-4 py-2">状態</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.quotes.map((q) => (
                    <tr key={q.id}>
                      <td className="px-4 py-2 whitespace-nowrap">
                        <Link href={`/quotes/${q.id}`} className="text-indigo-700 hover:underline">
                          {q.quoteNumber}
                        </Link>
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap">{formatDate(q.issueDate)}</td>
                      <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap">{formatYen(q.totalAmount)}</td>
                      <td className="px-4 py-2 whitespace-nowrap">{QUOTE_STATUS[q.status]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {!customer && (
        <section className="space-y-2">
          <h2 className="font-semibold">経費(領収書) 合計 {formatYen(data.totals.expenses)}</h2>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs whitespace-nowrap text-slate-500">
                  <tr>
                    <th className="px-4 py-2">日付</th>
                    <th className="px-4 py-2">内容</th>
                    <th className="px-4 py-2">勘定科目</th>
                    <th className="px-4 py-2">立て替えた人</th>
                    <th className="px-4 py-2 text-right">金額</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.expenses.map((e) => (
                    <tr key={e.id}>
                      <td className="px-4 py-2 whitespace-nowrap">{formatDate(e.expenseDate)}</td>
                      <td className="min-w-[10rem] px-4 py-2">{e.description}</td>
                      <td className="px-4 py-2 whitespace-nowrap">{e.account ? `${e.account.code} ${e.account.name}` : "-"}</td>
                      <td className="px-4 py-2 whitespace-nowrap">{e.expenseReport.employee.name}</td>
                      <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap">{formatYen(e.amount)}</td>
                    </tr>
                  ))}
                  {data.expenses.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                        この取引先の領収書はまだありません。
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

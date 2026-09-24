import { requireCompanyId } from "@/lib/auth/session";
import { getCashflow, type CashItem, type CashMonth } from "@/lib/accounting/cashflow";
import { formatYen } from "@/lib/format";

export const dynamic = "force-dynamic";

function monthLabel(m: string) {
  return `${m.slice(0, 4)}年${Number(m.slice(5))}月`;
}

function Items({ items, empty }: { items: CashItem[]; empty: string }) {
  if (!items.length) return <p className="text-xs text-slate-400">{empty}</p>;
  return (
    <ul className="space-y-1 text-xs">
      {items.map((i, n) => (
        <li key={n} className="flex justify-between gap-3">
          <span className="min-w-0 truncate text-slate-700" title={i.label}>
            {i.label}
            {i.note && <span className="ml-1 text-amber-700">({i.note})</span>}
          </span>
          <span className="shrink-0 tabular-nums">{formatYen(i.amount)}</span>
        </li>
      ))}
    </ul>
  );
}

export default async function CashflowPage() {
  const companyId = await requireCompanyId();
  const { months, shortage } = await getCashflow(companyId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">資金繰り予測</h1>
        <p className="mt-1 text-sm text-slate-600">
          今日の現預金(現金+普通預金)に、請求書の入金予定・支払予定、定期取引、立替経費の精算を足し引きして、この先3か月の残高を見込みます。
        </p>
      </div>

      {shortage ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <p className="font-semibold">{monthLabel(shortage)}末に資金が足りなくなる見込みです。</p>
          <p className="mt-1">入金の催促、支払日の調整、借入などを早めに検討してください。</p>
        </div>
      ) : (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">この3か月は、資金が不足する見込みはありません。</div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2 text-left" />
                {months.map((m) => (
                  <th key={m.month} className="px-4 py-2 text-right whitespace-nowrap">
                    {monthLabel(m.month)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {(
                [
                  ["月初の残高", (m: CashMonth) => m.opening, ""],
                  ["入金予定", (m: CashMonth) => m.inflow, "text-emerald-700"],
                  ["支払予定", (m: CashMonth) => -m.outflow, "text-rose-700"],
                ] as const
              ).map(([label, get, tone]) => (
                <tr key={label}>
                  <th scope="row" className="px-4 py-2 text-left font-normal whitespace-nowrap">
                    {label}
                  </th>
                  {months.map((m) => (
                    <td key={m.month} className={`px-4 py-2 text-right tabular-nums whitespace-nowrap ${tone}`}>
                      {label === "月初の残高" ? formatYen(get(m)) : get(m) === 0 ? "-" : `${get(m) > 0 ? "+" : "−"}${formatYen(Math.abs(get(m)))}`}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 bg-slate-50 font-semibold">
              <tr>
                <th scope="row" className="px-4 py-2 text-left whitespace-nowrap">
                  月末の残高(見込み)
                </th>
                {months.map((m) => (
                  <td key={m.month} className={`px-4 py-2 text-right tabular-nums whitespace-nowrap ${m.closing < 0 ? "text-rose-700" : ""}`}>
                    {m.closing < 0 ? `−${formatYen(-m.closing)}` : formatYen(m.closing)}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {months.map((m) => (
          <section key={m.month} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="font-semibold">{monthLabel(m.month)}の内訳</h2>
            <div>
              <h3 className="mb-1 text-xs font-semibold text-emerald-700">入金予定 {formatYen(m.inflow)}</h3>
              <Items items={m.inflows} empty="入金予定はありません" />
            </div>
            <div>
              <h3 className="mb-1 text-xs font-semibold text-rose-700">支払予定 {formatYen(m.outflow)}</h3>
              <Items items={m.outflows} empty="支払予定はありません" />
            </div>
          </section>
        ))}
      </div>

      <p className="text-xs text-slate-500">
        請求書の期日と定期取引から計算した見込みです。給料・税金・POSの売上など、登録していない入出金は含みません(定期取引に登録すると反映されます)。
      </p>
    </div>
  );
}

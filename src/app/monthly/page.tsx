import Link from "next/link";
import { requireCompanyId } from "@/lib/auth/session";
import { getMonthlyTable } from "@/lib/accounting/monthly";
import { CsvDownloadLink } from "@/components/CsvDownloadLink";

export const dynamic = "force-dynamic";

type Line = { months: number[]; total: number; budget: number | null };

// 表が横に長くなるので、月ごとの金額は「¥」を付けずに数字だけ並べる(単位: 円)
function yen(v: number) {
  return v === 0 ? "-" : v.toLocaleString("ja-JP");
}

// 予算に対する実績の割合。費用は予算を超えたら赤、収益は予算に届いたら緑で表示する。
function Ratio({ line, kind }: { line: Line; kind: "revenue" | "expense" | "profit" }) {
  if (line.budget === null || line.budget === 0) return <span className="text-slate-400">-</span>;
  const pct = Math.round((line.total / line.budget) * 100);
  const tone = kind === "expense" ? (pct > 100 ? "text-rose-700 font-semibold" : "") : pct >= 100 ? "text-emerald-700 font-semibold" : "";
  return <span className={tone}>{pct}%</span>;
}

function Row({ label, line, kind, strong, href }: { label: string; line: Line; kind: "revenue" | "expense" | "profit"; strong?: boolean; href?: string }) {
  const cell = `px-2 py-1.5 text-right tabular-nums whitespace-nowrap ${strong ? "font-semibold" : ""}`;
  return (
    <tr className={strong ? "border-t bg-slate-50/70" : ""}>
      <th scope="row" className={`sticky left-0 z-10 bg-white px-3 py-1.5 text-left whitespace-nowrap ${strong ? "bg-slate-50 font-semibold" : "font-normal"}`}>
        {href ? (
          <Link href={href} className="hover:underline">
            {label}
          </Link>
        ) : (
          label
        )}
      </th>
      {line.months.map((v, i) => (
        <td key={i} className={`${cell} ${v < 0 ? "text-rose-700" : ""}`}>
          {yen(v)}
        </td>
      ))}
      <td className={`${cell} border-l font-semibold ${line.total < 0 ? "text-rose-700" : ""}`}>{yen(line.total)}</td>
      <td className={`${cell} text-slate-600`}>{line.budget === null ? "-" : yen(line.budget)}</td>
      <td className={`${cell} pr-4`}>
        <Ratio line={line} kind={kind} />
      </td>
    </tr>
  );
}

export default async function MonthlyPage({ searchParams }: { searchParams: Promise<{ fy?: string }> }) {
  const companyId = await requireCompanyId();
  const { fy } = await searchParams;
  const t = await getMonthlyTable(companyId, fy);
  const empty = t.revenue.length === 0 && t.expense.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">月次推移表・予算</h1>
          <p className="mt-1 text-sm text-slate-600">
            売上・費用を勘定科目ごと・月ごとに並べます(単位: 円)。年間予算を設定すると、実績が予算の何%かを表示します。
          </p>
        </div>
        <div className="flex gap-2 self-start">
          <Link href={`/monthly/budget?fy=${t.year}`} className="rounded-md border border-indigo-600 px-3 py-1.5 text-xs font-medium whitespace-nowrap text-indigo-700 hover:bg-indigo-50">
            予算を設定
          </Link>
          <CsvDownloadLink href={`/api/monthly/export?fy=${t.year}`} />
        </div>
      </div>

      <div className="flex items-center gap-2 text-sm">
        <Link href={`/monthly?fy=${t.year - 1}`} className="rounded-md border px-2 py-1 hover:bg-slate-50" aria-label="前の年度">
          ◀
        </Link>
        <span className="font-medium">
          {t.year}年度({t.months[0].replace("-", "/")}〜{t.months[11].replace("-", "/")})
        </span>
        <Link href={`/monthly?fy=${t.year + 1}`} className="rounded-md border px-2 py-1 hover:bg-slate-50" aria-label="次の年度">
          ▶
        </Link>
        {t.year !== t.current && (
          <Link href="/monthly" className="text-indigo-700 hover:underline">
            今期
          </Link>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2 text-left font-medium">科目</th>
                {t.months.map((m) => (
                  <th key={m} className="px-2 py-2 text-right font-medium whitespace-nowrap">
                    {Number(m.slice(5))}月
                  </th>
                ))}
                <th className="border-l px-2 py-2 text-right font-medium">合計</th>
                <th className="px-2 py-2 text-right font-medium whitespace-nowrap">年間予算</th>
                <th className="px-2 py-2 pr-4 text-right font-medium whitespace-nowrap">予算比</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={16} className="bg-slate-50/60 px-3 py-1 text-xs font-semibold text-slate-500">
                  収益
                </td>
              </tr>
              {t.revenue.map((r) => (
                <Row key={r.accountId} label={`${r.code} ${r.name}`} line={r} kind="revenue" href={`/ledger?accountId=${r.accountId}`} />
              ))}
              <Row label="収益合計" line={t.revenueTotal} kind="revenue" strong />
              <tr>
                <td colSpan={16} className="bg-slate-50/60 px-3 py-1 text-xs font-semibold text-slate-500">
                  費用
                </td>
              </tr>
              {t.expense.map((r) => (
                <Row key={r.accountId} label={`${r.code} ${r.name}`} line={r} kind="expense" href={`/ledger?accountId=${r.accountId}`} />
              ))}
              <Row label="費用合計" line={t.expenseTotal} kind="expense" strong />
              <Row label="利益" line={t.profit} kind="profit" strong />
            </tbody>
          </table>
        </div>
        {empty && <p className="px-4 py-6 text-center text-sm text-slate-400">この年度の売上・費用の仕訳はまだありません。</p>}
      </div>

      <p className="text-xs text-slate-500">
        記帳済みの仕訳(レビュー待ち・取消は除く)を集計しています。予算比は「年間の実績 ÷ 年間予算」です(費用が予算を超えると赤、売上・利益が予算に届くと緑)。
      </p>
    </div>
  );
}

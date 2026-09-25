import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireCompanyId } from "@/lib/auth/session";
import { getFinancialStatements, type StatementRow } from "@/lib/accounting/financialStatements";
import { jstDateKey } from "@/lib/jst";
import { PrintButton } from "@/components/PrintButton";

export const dynamic = "force-dynamic";

function jp(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return `${y}年${m}月${d}日`;
}

const yen = (n: number) => (n < 0 ? `△${Math.abs(n).toLocaleString("ja-JP")}` : n.toLocaleString("ja-JP"));

const page = "mx-auto max-w-[210mm] bg-white p-6 text-[13px] leading-relaxed text-slate-900 shadow-sm ring-1 ring-slate-200 sm:p-12 print:max-w-none print:p-0 print:shadow-none print:ring-0 break-after-page";

function Rows({ rows, indent = 1 }: { rows: StatementRow[]; indent?: number }) {
  return (
    <>
      {rows.map((r) => (
        <tr key={`${r.code}-${r.name}`}>
          <td className="py-0.5" style={{ paddingLeft: `${indent}rem` }}>
            {r.name}
          </td>
          <td className="py-0.5 text-right tabular-nums">{yen(r.amount)}</td>
          <td />
        </tr>
      ))}
    </>
  );
}

function Total({ label, amount, strong = false, indent = 0 }: { label: string; amount: number; strong?: boolean; indent?: number }) {
  return (
    <tr className={strong ? "border-t border-slate-400 font-semibold" : "font-medium"}>
      <td className="py-1" style={{ paddingLeft: `${indent}rem` }}>
        {label}
      </td>
      <td />
      <td className="py-1 text-right tabular-nums">{yen(amount)}</td>
    </tr>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <tr>
        <td colSpan={3} className="pt-3 pb-1 font-semibold">
          【{title}】
        </td>
      </tr>
      {children}
    </>
  );
}

export default async function FinancialStatementsPage({ searchParams }: { searchParams: Promise<{ fy?: string }> }) {
  const companyId = await requireCompanyId();
  const { fy } = await searchParams;
  const requested = Number(fy);
  const today = jstDateKey(new Date());
  const [fs, company] = await Promise.all([
    getFinancialStatements(companyId, Number.isInteger(requested) && requested > 1900 && requested < 3000 ? requested : undefined, today),
    prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { name: true, address: true } }),
  ]);
  const { balanceSheet: bs, incomeStatement: pl } = fs;
  const t = pl.totals;

  return (
    <div className="space-y-6">
      <div className="space-y-3 print:hidden">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">決算報告書</h1>
            <p className="mt-1 text-sm text-slate-600">表紙・貸借対照表・損益計算書・販売費及び一般管理費内訳書を、1年分まとめて印刷(PDF保存)できます。</p>
          </div>
          <PrintButton />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Link href={`/financial-statements?fy=${fs.fiscalYear - 1}`} className="rounded-md border px-2 py-1 hover:bg-slate-50" aria-label="前の年度">
            ◀
          </Link>
          <span className="font-medium">
            {fs.fiscalYear}年度({jp(fs.from)}〜{jp(fs.to)})
          </span>
          <Link href={`/financial-statements?fy=${fs.fiscalYear + 1}`} className="rounded-md border px-2 py-1 hover:bg-slate-50" aria-label="次の年度">
            ▶
          </Link>
          {fs.fiscalYear !== fs.currentYear && (
            <Link href="/financial-statements" className="text-indigo-700 hover:underline">
              今期
            </Link>
          )}
        </div>
        {fs.inProgress && <p className="rounded-md bg-amber-50 px-4 py-2 text-sm text-amber-900">この年度はまだ終わっていないため、今日までに記帳した数字で作っています(期末の決算整理の前の数字です)。</p>}
        {!bs.balanced && <p className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-800">資産と負債・純資産の合計が一致していません。仕訳を確認してください。</p>}
      </div>

      {/* 表紙 */}
      <section className={`${page} flex min-h-[60vh] flex-col items-center justify-center text-center print:min-h-[250mm]`}>
        <p className="text-sm tracking-widest">{fs.fiscalYear}年度</p>
        <h2 className="mt-4 text-4xl font-bold tracking-[0.5em]">決算報告書</h2>
        <p className="mt-8 text-base">
          自 {jp(fs.from)}
          <br />至 {jp(fs.to)}
        </p>
        <p className="mt-16 text-xl font-semibold">{company.name}</p>
        {company.address && <p className="mt-1 text-sm">{company.address}</p>}
      </section>

      {/* 貸借対照表 */}
      <section className={page}>
        <h2 className="text-center text-2xl font-bold tracking-[0.3em]">貸借対照表</h2>
        <p className="mt-1 text-center text-sm">{jp(fs.to)} 現在</p>
        <p className="text-right text-xs">
          {company.name}　(単位: 円)
        </p>
        <div className="mt-2 grid gap-6 sm:grid-cols-2 print:grid-cols-2">
          <table className="w-full border-t-2 border-slate-600">
            <thead>
              <tr className="border-b border-slate-400 text-xs">
                <th className="py-1 text-left">資産の部</th>
                <th className="w-28" />
                <th className="w-28" />
              </tr>
            </thead>
            <tbody>
              <Section title="流動資産">
                <Rows rows={bs.currentAssets} />
                <Total label="流動資産合計" amount={bs.currentAssets.reduce((s, r) => s + r.amount, 0)} indent={1} />
              </Section>
              <Section title="固定資産">
                <Rows rows={bs.fixedAssets} />
                <Total label="固定資産合計" amount={bs.fixedAssets.reduce((s, r) => s + r.amount, 0)} indent={1} />
              </Section>
              <Total label="資産の部合計" amount={bs.totalAssets} strong />
            </tbody>
          </table>
          <table className="w-full border-t-2 border-slate-600">
            <thead>
              <tr className="border-b border-slate-400 text-xs">
                <th className="py-1 text-left">負債の部</th>
                <th className="w-28" />
                <th className="w-28" />
              </tr>
            </thead>
            <tbody>
              <Section title="流動負債">
                <Rows rows={bs.currentLiabilities} />
                <Total label="流動負債合計" amount={bs.currentLiabilities.reduce((s, r) => s + r.amount, 0)} indent={1} />
              </Section>
              {bs.fixedLiabilities.length > 0 && (
                <Section title="固定負債">
                  <Rows rows={bs.fixedLiabilities} />
                  <Total label="固定負債合計" amount={bs.fixedLiabilities.reduce((s, r) => s + r.amount, 0)} indent={1} />
                </Section>
              )}
              <Total label="負債の部合計" amount={bs.totalLiabilities} strong />
              <tr className="border-b border-slate-400 text-xs">
                <th className="pt-4 pb-1 text-left">純資産の部</th>
                <th />
                <th />
              </tr>
              <Section title="株主資本">
                <Rows rows={bs.equity} />
              </Section>
              <Total label="純資産の部合計" amount={bs.totalEquity} strong />
              <Total label="負債・純資産の部合計" amount={bs.totalLiabilities + bs.totalEquity} strong />
            </tbody>
          </table>
        </div>
      </section>

      {/* 損益計算書 */}
      <section className={page}>
        <h2 className="text-center text-2xl font-bold tracking-[0.3em]">損益計算書</h2>
        <p className="mt-1 text-center text-sm">
          自 {jp(fs.from)}　至 {jp(fs.to)}
        </p>
        <p className="text-right text-xs">
          {company.name}　(単位: 円)
        </p>
        <table className="mt-2 w-full border-t-2 border-slate-600">
          <colgroup>
            <col />
            <col className="w-32" />
            <col className="w-32" />
          </colgroup>
          <tbody>
            <Section title="売上高">
              <Rows rows={pl.sales} />
              <Total label="売上高合計" amount={t.sales} indent={1} />
            </Section>
            <Section title="売上原価">
              <Rows rows={pl.costOfSales} />
              <Total label="売上原価合計" amount={t.costOfSales} indent={1} />
            </Section>
            <Total label="売上総利益" amount={t.grossProfit} strong />
            <Section title="販売費及び一般管理費">
              <tr>
                <td className="py-0.5 pl-4">販売費及び一般管理費(内訳は別紙)</td>
                <td />
                <td className="py-0.5 text-right tabular-nums">{yen(t.sga)}</td>
              </tr>
            </Section>
            <Total label="営業利益" amount={t.operatingProfit} strong />
            {(pl.nonOpRevenue.length > 0 || pl.nonOpExpense.length > 0) && (
              <>
                <Section title="営業外収益">
                  <Rows rows={pl.nonOpRevenue} />
                  <Total label="営業外収益合計" amount={t.nonOpRevenue} indent={1} />
                </Section>
                <Section title="営業外費用">
                  <Rows rows={pl.nonOpExpense} />
                  <Total label="営業外費用合計" amount={t.nonOpExpense} indent={1} />
                </Section>
              </>
            )}
            <Total label="経常利益" amount={t.ordinaryProfit} strong />
            {(pl.extraGain.length > 0 || pl.extraLoss.length > 0) && (
              <>
                <Section title="特別利益">
                  <Rows rows={pl.extraGain} />
                  <Total label="特別利益合計" amount={t.extraGain} indent={1} />
                </Section>
                <Section title="特別損失">
                  <Rows rows={pl.extraLoss} />
                  <Total label="特別損失合計" amount={t.extraLoss} indent={1} />
                </Section>
              </>
            )}
            <Total label="税引前当期純利益" amount={t.netIncome} strong />
            <Total label="当期純利益" amount={t.netIncome} strong />
          </tbody>
        </table>
        <p className="mt-4 text-xs text-slate-500 print:hidden">※ 法人税等は計上していません(税引前当期純利益と当期純利益は同じ金額です)。</p>
      </section>

      {/* 販売費及び一般管理費内訳書 */}
      <section className={page.replace(" break-after-page", "")}>
        <h2 className="text-center text-xl font-bold tracking-[0.2em]">販売費及び一般管理費内訳書</h2>
        <p className="mt-1 text-center text-sm">
          自 {jp(fs.from)}　至 {jp(fs.to)}
        </p>
        <p className="text-right text-xs">
          {company.name}　(単位: 円)
        </p>
        <table className="mt-2 w-full border-t-2 border-slate-600">
          <tbody>
            {pl.sga.map((r) => (
              <tr key={r.code} className="border-b border-slate-200">
                <td className="py-1">{r.name}</td>
                <td className="py-1 text-right tabular-nums">{yen(r.amount)}</td>
              </tr>
            ))}
            {pl.sga.length === 0 && (
              <tr>
                <td colSpan={2} className="py-3 text-center text-slate-400">
                  この年度の販売費及び一般管理費はありません
                </td>
              </tr>
            )}
            <tr className="border-t border-slate-400 font-semibold">
              <td className="py-1.5">合計</td>
              <td className="py-1.5 text-right tabular-nums">{yen(t.sga)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <div className="space-y-1 text-xs text-slate-500 print:hidden">
        <p>・記帳済みの仕訳から作っています。減価償却・棚卸などの決算整理を記帳してから印刷してください。</p>
        <p>・流動・固定の区分は勘定科目コードで判断しています(資産1500番台以降と負債2200番台以降を固定とみなします)。</p>
        <p>・税務申告に使う前に、税理士に内容を確認してもらってください。</p>
      </div>
    </div>
  );
}

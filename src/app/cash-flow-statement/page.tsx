import Link from "next/link";
import { getCashFlowStatement, type CashFlowRow } from "@/lib/accounting/cashFlowStatement";
import { requireCompanyId } from "@/lib/auth/session";
import { formatYen } from "@/lib/format";
import { CsvDownloadLink } from "@/components/CsvDownloadLink";
import { PeriodPicker } from "@/components/PeriodPicker";
import { getFiscalStartMonth, periodQuery, resolvePeriod, toRange, type PeriodParams } from "@/lib/accounting/period";

export const dynamic = "force-dynamic";

// 決算書の書き方に合わせて、マイナスは「△」で表す
const yen = (n: number) => (n < 0 ? `△${formatYen(-n)}` : formatYen(n));

function Section({ title, rows, extra }: { title: string; rows: CashFlowRow[]; extra?: React.ReactNode }) {
  return (
    <>
      <tr className="bg-slate-50/60">
        <td colSpan={2} className="px-4 py-1 text-xs font-semibold text-slate-500">
          {title}
        </td>
      </tr>
      {rows.length ? (
        rows.map((r) => (
          <tr key={r.label}>
            <td className="px-4 py-2 pl-8">{r.label}</td>
            <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap">{yen(r.amount)}</td>
          </tr>
        ))
      ) : (
        <tr>
          <td colSpan={2} className="px-4 py-2 pl-8 text-slate-400">
            この期間の動きはありません
          </td>
        </tr>
      )}
      {extra}
    </>
  );
}

function Total({ label, amount, strong }: { label: string; amount: number; strong?: boolean }) {
  return (
    <tr className={`border-t ${strong ? "bg-slate-50 font-semibold" : "font-medium"}`}>
      <td className="px-4 py-2">{label}</td>
      <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap">{yen(amount)}</td>
    </tr>
  );
}

function Tile({ label, amount, note }: { label: string; amount: number; note: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{yen(amount)}</p>
      <p className="mt-1 text-xs text-slate-500">{note}</p>
    </div>
  );
}

export default async function CashFlowStatementPage({ searchParams }: { searchParams: Promise<PeriodParams> }) {
  const companyId = await requireCompanyId();
  const period = resolvePeriod(await searchParams, await getFiscalStartMonth(companyId));
  const cf = await getCashFlowStatement(companyId, toRange(period));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">キャッシュ・フロー計算書</h1>
          <p className="mt-1 text-sm text-slate-600">
            期間のお金(現金・預金)の増減を、本業(営業活動)・設備など(投資活動)・借入や出資(財務活動)に分けて表示します。利益が出ているのにお金が増えない理由がわかります。
          </p>
          <p className="mt-1 text-sm font-medium text-slate-800">{period.label}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap ${cf.balanced ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"}`}>
            {cf.balanced ? "期首+増減=期末" : "期首+増減≠期末"}
          </span>
          <CsvDownloadLink href={`/api/cash-flow-statement/export?${periodQuery(period)}`} print />
        </div>
      </div>

      <PeriodPicker path="/cash-flow-statement" period={period} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 print:hidden">
        <Tile label="営業活動" amount={cf.operating} note={cf.operating >= 0 ? "本業でお金が増えました" : "本業でお金が減りました"} />
        <Tile label="投資活動" amount={cf.investing} note="設備の購入・売却など" />
        <Tile label="財務活動" amount={cf.financing} note="借入・返済・出資など" />
        <Tile label="フリー・キャッシュ・フロー" amount={cf.freeCashFlow} note="営業+投資。自由に使えるお金" />
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2">区分</th>
                <th className="px-4 py-2 text-right">金額</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              <Section
                title="Ⅰ 営業活動によるキャッシュ・フロー"
                rows={cf.operatingRows}
                extra={
                  <>
                    <Total label="小計" amount={cf.subtotal} />
                    {cf.interestPaid !== 0 && (
                      <tr>
                        <td className="px-4 py-2 pl-8">利息の支払額</td>
                        <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap">{yen(cf.interestPaid)}</td>
                      </tr>
                    )}
                    {cf.taxesPaid !== 0 && (
                      <tr>
                        <td className="px-4 py-2 pl-8">法人税等の支払額</td>
                        <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap">{yen(cf.taxesPaid)}</td>
                      </tr>
                    )}
                  </>
                }
              />
              <Total label="営業活動によるキャッシュ・フロー" amount={cf.operating} strong />
              <Section title="Ⅱ 投資活動によるキャッシュ・フロー" rows={cf.investingRows} />
              <Total label="投資活動によるキャッシュ・フロー" amount={cf.investing} strong />
              <Section title="Ⅲ 財務活動によるキャッシュ・フロー" rows={cf.financingRows} />
              <Total label="財務活動によるキャッシュ・フロー" amount={cf.financing} strong />
              <Total label="Ⅳ 現金及び現金同等物の増減額" amount={cf.change} strong />
              <Total label="Ⅴ 現金及び現金同等物の期首残高" amount={cf.beginning} />
              <Total label="Ⅵ 現金及び現金同等物の期末残高" amount={cf.ending} strong />
            </tbody>
          </table>
        </div>
      </div>

      {cf.cashAccounts.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2">現金及び現金同等物の内訳</th>
                  <th className="px-4 py-2 text-right">期首</th>
                  <th className="px-4 py-2 text-right">期末</th>
                  <th className="px-4 py-2 text-right">増減</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {cf.cashAccounts.map((a) => (
                  <tr key={a.code}>
                    <td className="px-4 py-2 whitespace-nowrap">
                      {a.code} {a.name}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap">{yen(a.beginning)}</td>
                    <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap">{yen(a.ending)}</td>
                    <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap">{yen(a.ending - a.beginning)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="space-y-1 text-xs text-slate-500">
        <p>
          見方: △はマイナス(お金が出ていった)です。「売上債権の増減額」は売掛金が増えると△(売上は上がってもまだ入金されていない)、「仕入債務の増減額」は買掛金が増えるとプラス(まだ払っていない)になります。
        </p>
        <p>
          作り方: 間接法(税引前当期純利益から、お金の出入りのない費用や、売掛金・買掛金などの増減を調整)で、記帳済みの仕訳から作っています。税引前当期純利益は、損益計算書の純利益に法人税等を足し戻した金額です。法人税等は、実際に納めた額を小計の下の「法人税等の支払額」に出します。固定資産を未払金で買ったときは、取得が投資活動の支出に、未払金の増加が営業活動に入ります。
        </p>
        <p>
          今後のお金の見通しは
          <Link href="/cashflow" className="mx-1 text-indigo-700 hover:underline">
            資金繰り予測
          </Link>
          、利益は
          <Link href={`/income-statement?${periodQuery(period)}`} className="mx-1 text-indigo-700 hover:underline">
            損益計算書
          </Link>
          で確かめられます。
        </p>
      </div>
    </div>
  );
}

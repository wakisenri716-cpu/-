import Link from "next/link";
import { requireCompanyId } from "@/lib/auth/session";
import { PeriodPicker } from "@/components/PeriodPicker";
import { getFiscalStartMonth, periodQuery, resolvePeriod, type PeriodParams } from "@/lib/accounting/period";
import { EXPORT_FILES, getExportSummary } from "@/lib/accountantExport";

export const dynamic = "force-dynamic";

// 税理士さんに渡すデータを、期間を選んでまとめてダウンロードする
export default async function AccountantExportPage({ searchParams }: { searchParams: Promise<PeriodParams> }) {
  const companyId = await requireCompanyId();
  const params = await searchParams;
  const period = resolvePeriod(params.preset || params.from || params.to ? params : { preset: "last-fy" }, await getFiscalStartMonth(companyId));
  const { entries, checks } = await getExportSummary(companyId, period);
  const pending = checks.filter((c) => !c.ok).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">税理士向けデータ</h1>
        <p className="mt-1 text-sm text-slate-600">
          決算や申告のときに税理士さんへ渡すデータを、期間を選んでまとめてダウンロードします。仕訳は弥生会計・マネーフォワード クラウド会計にそのまま取り込める形式でも入ります。
        </p>
      </div>

      <PeriodPicker path="/accountant-export" period={period} />

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm text-slate-500">{period.label}</div>
            <div className="text-lg font-semibold">記帳済みの仕訳 {entries.toLocaleString("ja-JP")}件</div>
          </div>
          {/* ページ遷移ではなくファイルのダウンロードなので <a> を使う */}
          <a
            href={`/api/accountant-export?${periodQuery(period)}`}
            className="rounded-md bg-vermilion-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-vermilion-700"
          >
            ZIPでダウンロード
          </a>
        </div>
        {pending > 0 && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
            渡す前に確認したいことが{pending}件あります。このままでもダウンロードできますが、片づけてから渡すと税理士さんとのやりとりが減ります。
          </p>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <h2 className="border-b px-4 py-3 font-semibold">渡す前の確認</h2>
        <ul className="divide-y">
          {checks.map((c) => (
            <li key={c.label} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3 text-sm">
              <div className="flex min-w-0 items-start gap-2">
                <span className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${c.ok ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}`}>
                  {c.ok ? "✓" : "!"}
                </span>
                <div>
                  <div className="font-medium">{c.label}</div>
                  <div className="text-slate-600">{c.detail}</div>
                </div>
              </div>
              {!c.ok && (
                <Link href={c.href} className="text-sm whitespace-nowrap text-indigo-700 hover:underline">
                  開く →
                </Link>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <h2 className="border-b px-4 py-3 font-semibold">ZIPに入るファイル</h2>
        <ul className="divide-y text-sm">
          {EXPORT_FILES.map(([name, desc]) => (
            <li key={name} className="px-4 py-2">
              <div className="font-medium break-all">{name}</div>
              <div className="text-slate-500">{desc}</div>
            </li>
          ))}
        </ul>
      </section>

      <p className="text-xs text-slate-500">
        税理士さんに画面を直接見てもらうこともできます。「ユーザー管理」で役割を「経理担当」にして招待すると、帳票や証憑を見られます(従業員の管理や会社の設定は変えられません)。
      </p>
    </div>
  );
}

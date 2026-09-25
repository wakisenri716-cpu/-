import { getAnalysis, type Metric } from "@/lib/accounting/analysis";
import { requireCompanyId } from "@/lib/auth/session";
import { formatYen } from "@/lib/format";
import { jstDateKey } from "@/lib/jst";
import { PeriodPicker } from "@/components/PeriodPicker";
import { PrintButton } from "@/components/PrintButton";
import { getFiscalStartMonth, resolvePeriod, type PeriodParams } from "@/lib/accounting/period";

export const dynamic = "force-dynamic";

function display(k: string) {
  const [y, m, d] = k.split("-").map(Number);
  return `${y}/${m}/${d}`;
}

function format(value: number | null, unit: Metric["unit"]) {
  if (value === null) return "-";
  const digits = unit === "日" ? 0 : 1;
  return `${value.toFixed(digits)}${unit}`;
}

function Change({ metric }: { metric: Metric }) {
  if (metric.current === null || metric.prior === null) return <span className="text-slate-400">前年同期: {format(metric.prior, metric.unit)}</span>;
  const diff = metric.current - metric.prior;
  const better = metric.higherIsBetter ? diff > 0 : diff < 0;
  const unit = metric.unit === "%" ? "ポイント" : metric.unit;
  const digits = metric.unit === "日" ? 0 : 1;
  return (
    <span>
      <span className="text-slate-500">前年同期 {format(metric.prior, metric.unit)}</span>{" "}
      {Math.abs(diff) < 0.05 ? (
        <span className="text-slate-400">(横ばい)</span>
      ) : (
        <span className={better ? "text-emerald-700" : "text-rose-700"}>
          ({diff > 0 ? "▲" : "▼"}
          {Math.abs(diff).toFixed(digits)}
          {unit})
        </span>
      )}
    </span>
  );
}

function Judge({ metric }: { metric: Metric }) {
  if (metric.current === null || !metric.good) return null;
  const ok = metric.good(metric.current);
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${ok ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
      <span aria-hidden>{ok ? "✓" : "!"}</span>
      {ok ? "目安をクリア" : "要チェック"}
    </span>
  );
}

export default async function AnalysisPage({ searchParams }: { searchParams: Promise<PeriodParams> }) {
  const companyId = await requireCompanyId();
  const period = resolvePeriod(await searchParams, await getFiscalStartMonth(companyId));
  const today = jstDateKey(new Date());
  const analysis = period.from && period.to ? await getAnalysis(companyId, { from: period.from, to: period.to }, today) : null;
  const groups = ["収益性", "安全性", "効率性"] as const;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">経営分析</h1>
          <p className="mt-1 text-sm text-slate-600">記帳済みの数字から、もうけの力(収益性)・つぶれにくさ(安全性)・お金の回り(効率性)を計算し、前年同期と比べます。</p>
          {analysis && (
            <p className="mt-1 text-sm font-medium text-slate-800">
              {display(analysis.from)}〜{display(analysis.to)}
              <span className="ml-2 text-xs font-normal text-slate-500">
                (前年同期 {display(analysis.priorFrom)}〜{display(analysis.priorTo)})
              </span>
            </p>
          )}
        </div>
        <div className="shrink-0 self-start print:hidden">
          <PrintButton />
        </div>
      </div>

      <PeriodPicker path="/analysis" period={period} />

      {!analysis ? (
        <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
          経営分析は、始まりと終わりが決まった期間で計算します。「今期」などの期間を選んでください。
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { label: "売上高", value: analysis.figures.sales, prior: analysis.prior?.sales },
              { label: "売上総利益(粗利)", value: analysis.figures.grossProfit, prior: analysis.prior?.grossProfit },
              { label: "営業利益", value: analysis.figures.operatingProfit, prior: analysis.prior?.operatingProfit },
              { label: "現預金(期末)", value: analysis.figures.cash, prior: analysis.prior?.cash },
            ].map((t) => (
              <div key={t.label} className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="text-xs text-slate-500">{t.label}</div>
                <div className={`mt-1 truncate text-xl font-semibold tabular-nums ${t.value < 0 ? "text-rose-700" : ""}`}>{formatYen(t.value)}</div>
                {t.prior !== undefined && <div className="mt-1 truncate text-xs text-slate-500 tabular-nums">前年同期 {formatYen(t.prior)}</div>}
              </div>
            ))}
          </div>

          {!analysis.hasPrior && <p className="text-xs text-slate-500">前年同期の記帳がないため、前年との比較は表示していません。</p>}

          {groups.map((group) => (
            <section key={group} className="space-y-3">
              <h2 className="font-medium">{group}</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {analysis.metrics
                  .filter((m) => m.group === group)
                  .map((m) => (
                    <div key={m.key} className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm break-inside-avoid">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-medium">{m.label}</span>
                        <Judge metric={m} />
                      </div>
                      <div className="mt-1 text-2xl font-semibold tabular-nums">{format(m.current, m.unit)}</div>
                      <div className="mt-0.5 text-xs tabular-nums">
                        <Change metric={m} />
                      </div>
                      <p className="mt-2 text-xs text-slate-600">{m.explain}</p>
                      <p className="mt-1 text-xs text-slate-500">目安: {m.guide}</p>
                    </div>
                  ))}
              </div>
            </section>
          ))}

          <div className="space-y-1 text-xs text-slate-500">
            <p>・売上高は「売上高」の科目、営業利益は売上高から売上原価と販売費・一般管理費(支払利息・固定資産除売却損を除く費用)を引いて計算しています。</p>
            <p>・流動資産は科目コード1000〜1499、流動負債は2000〜2199の科目です(借入金は長期として扱っています)。期間の終わりが今日より後の場合は、今日までの数字で計算します。</p>
            <p>・目安は一般的な水準です。業種や会社の段階によって適切な値は変わるので、判断に迷うときは税理士などの専門家に相談してください。</p>
          </div>
        </>
      )}
    </div>
  );
}

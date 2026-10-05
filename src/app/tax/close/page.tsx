import Link from "next/link";
import { requireCompanyId } from "@/lib/auth/session";
import { getConsumptionTaxClose } from "@/lib/accounting/consumptionTaxClose";
import { formatYen } from "@/lib/format";
import { CloseActions } from "./CloseActions";

export const dynamic = "force-dynamic";

const jp = (k: string) => {
  const [y, m, d] = k.split("-").map(Number);
  return `${y}年${m}月${d}日`;
};

function Row({ label, amount, sub, strong, minus }: { label: string; amount: number; sub?: string; strong?: boolean; minus?: boolean }) {
  return (
    <div className={`flex items-start justify-between gap-3 py-1.5 ${strong ? "border-t border-slate-300 font-semibold" : ""}`}>
      <span>
        {label}
        {sub && <span className="block text-xs font-normal text-slate-500">{sub}</span>}
      </span>
      <span className="whitespace-nowrap tabular-nums">
        {minus && amount > 0 ? "−" : ""}
        {formatYen(amount)}
      </span>
    </div>
  );
}

// 消費税の決算整理(未払消費税等の計上)と翌年度の中間申告の目安
export default async function ConsumptionTaxClosePage({ searchParams }: { searchParams: Promise<{ fy?: string }> }) {
  const companyId = await requireCompanyId();
  const fyParam = Number((await searchParams).fy);
  const s = await getConsumptionTaxClose(companyId, Number.isInteger(fyParam) ? fyParam : undefined);
  const plan = s.nextInterim;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/tax" className="text-sm text-indigo-700 hover:underline">
          ← 消費税集計
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">消費税の決算整理</h1>
        <p className="mt-1 text-sm text-slate-600">
          期末に、1年間の仮受消費税と仮払消費税を相殺して、確定申告で納める消費税を「未払消費税等」にします。簡易課税・2割特例で「預かった − 支払った」と納める額が違う分は雑収入(または雑損失)になります。
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link href={`/tax/close?fy=${s.fiscalYear - 1}`} className="rounded-md border px-2 py-1 hover:bg-slate-50" aria-label="前の年度">
          ◀
        </Link>
        <span className="font-medium">
          {s.fiscalYear}年度({jp(s.from)}〜{jp(s.to)})
        </span>
        <Link href={`/tax/close?fy=${s.fiscalYear + 1}`} className="rounded-md border px-2 py-1 hover:bg-slate-50" aria-label="次の年度">
          ▶
        </Link>
        {s.fiscalYear !== s.currentYear && (
          <Link href="/tax/close" className="text-indigo-700 hover:underline">
            今期
          </Link>
        )}
        {s.posted && (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
            計上済み({s.posted.at.replaceAll("-", "/")} {s.posted.by})
          </span>
        )}
      </div>
      {s.inProgress && <p className="rounded-md bg-amber-50 px-4 py-2 text-sm text-amber-900">この年度はまだ終わっていないため、今日までに記帳した数字での見込みです。</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
          <h2 className="mb-2 font-semibold">納める消費税</h2>
          <p className="mb-2 text-xs text-slate-500">
            計算方式: {s.methodLabel}
            {s.businessType && `・${s.businessType}`}(
            <Link href="/tax" className="text-indigo-700 hover:underline">
              消費税集計
            </Link>
            で変えられます)
          </p>
          <Row label="預かった消費税(仮受消費税)" amount={s.output} />
          <Row label="支払った消費税(仮払消費税)" amount={s.input} />
          {s.notDeductible > 0 && <Row label="経過措置で控除できない額" amount={s.notDeductible} sub="インボイス登録のない取引先からの仕入" />}
          <Row label="消費税(国税 7.8%分)" amount={s.national} sub="百円未満切り捨て" />
          <Row label="地方消費税" amount={s.local} sub="消費税 × 22/78" />
          <Row label="年間の消費税等" amount={s.total} strong />
          <Row label="中間納付(中間納付消費税)" amount={s.interim} minus />
          <Row label={s.payable >= 0 ? "確定申告で納める見込み" : "還付される見込み"} amount={Math.abs(s.payable)} strong />
          {s.difference !== 0 && (
            <p className="mt-2 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
              「預かった − 支払った」との差 {formatYen(Math.abs(s.difference))} は{s.difference > 0 ? "雑収入" : "雑損失"}にします
              {s.difference > 0 ? "(簡易課税・2割特例で納める額が少ない分など)" : "(経過措置で控除できない分・端数など)"}。
            </p>
          )}
          <CloseActions fy={s.fiscalYear} canPost={s.canPost} posted={!!s.posted} endMonth={Number(s.to.slice(5, 7))} empty={s.output === 0 && s.input === 0 && s.interim === 0} />
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
          <h2 className="mb-2 font-semibold">翌年度の中間申告の目安</h2>
          <p className="mb-3 text-xs text-slate-500">今年度の消費税額(国税 {formatYen(s.national)})で、翌年度の中間申告の回数が決まります。</p>
          {plan.count === 0 ? (
            <p className="text-slate-600">{plan.note}</p>
          ) : (
            <>
              <p className="mb-2 font-medium">{plan.note}</p>
              <Row label="1回あたりの消費税(国税)" amount={plan.national} />
              <Row label="1回あたりの地方消費税" amount={plan.local} />
              <Row label="1回あたりの納付額" amount={plan.each} strong />
              <Row label="中間納付の合計(年間)" amount={plan.each * plan.count} />
              <p className="mt-2 text-xs text-slate-500">
                それぞれの期間の末日から2か月以内に納めます。納めたときは「中間納付消費税 / 普通預金」で記帳してください(期末の決算整理で取り崩します)。
              </p>
            </>
          )}
          <div className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
            区分: 48万円以下 なし / 48万円超〜400万円 年1回 / 400万円超〜4,800万円 年3回 / 4,800万円超 年11回(いずれも前年度の消費税額・国税)
          </div>
        </section>
      </div>

      <div className="space-y-1 text-xs text-slate-500">
        <p>・仕訳(期末の日付): 仮受消費税 / 仮払消費税・中間納付消費税・未払消費税等(還付なら未収消費税等)、差額は雑収入・雑損失。翌期に納めたら「未払消費税等 / 普通預金」です。</p>
        <p>・税率ごとの課税標準額の計算(積上げ計算・割戻し計算)はしていない目安です。申告書は国税庁の確定申告書等作成コーナーや税理士で作ってください。</p>
      </div>
    </div>
  );
}

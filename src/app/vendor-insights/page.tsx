import Link from "next/link";
import { requireCompanyId } from "@/lib/auth/session";
import { findVendorInsights, getVendorAdvice, VENDOR_INSIGHT_LABELS, type VendorInsight } from "@/lib/vendorInsights";
import { SparkleIcon } from "@/components/icons";
import { AdviseButton } from "./AdviseButton";

export const dynamic = "force-dynamic";

const TONE = { warn: "border-rose-200", info: "border-slate-200" };
const BADGE = { warn: "bg-rose-100 text-rose-700", info: "bg-sky-100 text-sky-800" };

// 仕入先の見守り: 値上がり・支払いの急増・インボイス登録・偏り・初めての大きな支払い
export default async function VendorInsightsPage() {
  const companyId = await requireCompanyId();
  const [r, note] = await Promise.all([findVendorInsights(companyId), getVendorAdvice(companyId)]);
  const advice = note?.key === r.today ? (note.data as { summary: string; insights: VendorInsight[] }) : null;
  const actionOf = (i: VendorInsight) => advice?.insights.find((a) => a.vendorId === i.vendorId && a.kind === i.kind)?.action ?? i.action;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">仕入先の見守り</h1>
        <p className="mt-1 text-sm text-slate-600">
          受け取った請求書と経費から、仕入先・支払先ごとの変化(値上がり・支払いの急増・インボイス登録なし/未確認・支払いの偏り・初めての大きな支払い)を見つけ、次にどう動くかを出します。{r.vendors}社 を見ています。
        </p>
      </div>

      <section className="rounded-xl border border-indigo-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-1.5 font-semibold text-indigo-900">
            <SparkleIcon className="h-4 w-4" />
            AIの提案
          </h2>
          <AdviseButton label={advice ? "もう一度考えてもらう" : "仕入先ごとの動き方をAIに考えてもらう"} />
        </div>
        <p className="mt-2 text-sm">{advice ? advice.summary : "下の変化それぞれに、AIが仕入先に合わせた次の動き方(交渉・相見積もり・登録の確認など)を一言で提案します(いまは決まった文面を出しています)。"}</p>
        {note && note.key === r.today && <p className="mt-1 text-xs text-slate-500">{note.mode === "claude" ? "AIが考えました" : "決まったルールで出しました"}</p>}
      </section>

      {r.insights.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">目立った変化のある仕入先はありません。</div>
      ) : (
        <ul className="space-y-3">
          {r.insights.map((i, n) => (
            <li key={n} className={`rounded-xl border bg-white p-4 shadow-sm ${TONE[i.level]}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${BADGE[i.level]}`}>{VENDOR_INSIGHT_LABELS[i.kind]}</span>
                  <span className="font-medium">{i.title}</span>
                </div>
                <Link href={`/vendors/vendor/${i.vendorId}`} className="text-sm text-indigo-700 hover:underline">
                  取引先を開く →
                </Link>
              </div>
              <p className="mt-1 text-sm text-slate-600">{i.detail}</p>
              <p className="mt-2 rounded-md bg-slate-50 px-3 py-2 text-sm">
                <span className="mr-1 text-xs font-semibold text-indigo-700">次の一手</span>
                {actionOf(i)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

import Link from "next/link";
import { requireCompanyId } from "@/lib/auth/session";
import { aiEnabled } from "@/lib/ai/access";
import { officeFacts, templateSummary } from "@/lib/officeToday";
import OfficeSummary from "./OfficeSummary";

export const dynamic = "force-dynamic";

const WEEK = "日月火水木金土";
const jp = (k: string) => `${Number(k.slice(5, 7))}月${Number(k.slice(8, 10))}日(${WEEK[new Date(`${k}T00:00:00Z`).getUTCDay()]})`;

function Card({ href, title, count, tone = "slate", children }: { href: string; title: string; count?: number | string; tone?: "slate" | "amber" | "rose"; children?: React.ReactNode }) {
  const ring = tone === "rose" ? "border-rose-200" : tone === "amber" ? "border-amber-200" : "border-slate-200";
  const badge = tone === "rose" ? "bg-rose-50 text-rose-800" : tone === "amber" ? "bg-amber-50 text-amber-900" : "bg-slate-100 text-slate-600";
  return (
    <Link href={href} className={`block space-y-1.5 rounded-xl border bg-white p-4 text-sm shadow-sm hover:bg-slate-50 ${ring}`}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">{title}</h2>
        {count !== undefined && <span className={`rounded-full px-2 py-0.5 text-xs ${badge}`}>{count}</span>}
      </div>
      {children}
    </Link>
  );
}

export default async function OfficePage() {
  const companyId = await requireCompanyId();
  const [f, ai] = await Promise.all([officeFacts(companyId), aiEnabled(companyId)]);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">総務のきょう({jp(f.today)})</h1>
        <p className="mt-1 text-sm text-slate-600">来客・会議室と社用車・アルコールチェック・郵便物・伝言・購入依頼・質問・イベント・資格・採用・休む人を1つにまとめました。押すとそれぞれの画面に進みます。</p>
      </div>
      <OfficeSummary initial={templateSummary(f)} ai={ai} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {f.safetyWaiting + f.safetyHelp > 0 && (
          <Card href="/safety" title={f.safetyDrill ? "安否確認の訓練" : "安否確認"} count={`${f.safetyWaiting + f.safetyHelp}人`} tone="rose">
            <p className="text-rose-700">{[f.safetyHelp ? `けが・助けが必要 ${f.safetyHelp}人` : "", f.safetyWaiting ? `まだ答えていない ${f.safetyWaiting}人` : ""].filter(Boolean).join("・")}</p>
          </Card>
        )}
        <Card href="/visitors" title="今日の来客" count={`${f.visitors.length}件`} tone={f.visitors.length ? "amber" : "slate"}>
          {f.visitors.length ? (
            <ul className="space-y-0.5 text-slate-600">
              {f.visitors.slice(0, 5).map((v, i) => (
                <li key={i}>
                  {v.time ?? "時刻なし"} {v.label}
                  {v.host ? `(${v.host})` : ""}
                  {v.arrived ? " — お見えになっている" : ""}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-slate-500">予定はありません</p>
          )}
        </Card>
        <Card href="/bookings" title="会議室の予約" count={`${f.bookings.length}件`}>
          {f.bookings.length ? (
            <ul className="space-y-0.5 text-slate-600">
              {f.bookings.slice(0, 5).map((b, i) => (
                <li key={i}>
                  {b.time} {b.facility} {b.title}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-slate-500">予約はありません</p>
          )}
        </Card>
        <Card href="/alcohol-checks" title="社用車とアルコールチェック" count={f.alcoholMissing ? `記録漏れ ${f.alcoholMissing}件` : `${f.cars.length}件`} tone={f.alcoholMissing ? "rose" : "slate"}>
          {f.cars.length ? (
            <ul className="space-y-0.5 text-slate-600">
              {f.cars.slice(0, 5).map((c, i) => (
                <li key={i}>
                  {c.time} {c.vehicle} {c.driver} — 運転前 {c.before ? "済" : "まだ"}・運転後 {c.after ? "済" : "まだ"}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-slate-500">今日の社用車の予約はありません</p>
          )}
        </Card>
        <Card href="/mail-log" title="渡していない郵便物・荷物" count={`${f.mailWaiting}件`} tone={f.mailImportant ? "rose" : f.mailWaiting ? "amber" : "slate"}>
          {f.mailImportant > 0 && <p className="text-rose-700">書留・役所から・請求書が{f.mailImportant}件</p>}
        </Card>
        <Card href="/phone-memos" title="対応していない伝言" count={`${f.memosOpen}件`} tone={f.memosOpen ? "amber" : "slate"} />
        <Card href="/supplies" title="備品・消耗品の購入依頼" count={`${f.supplies}件`} tone={f.suppliesUrgent ? "rose" : f.supplies ? "amber" : "slate"}>
          {f.suppliesUrgent > 0 && <p className="text-rose-700">至急が{f.suppliesUrgent}件</p>}
        </Card>
        <Card href="/staff-questions" title="従業員からの質問" count={`${f.questions}件`} tone={f.questions ? "amber" : "slate"} />
        <Card href="/events" title="社内のイベント(2週間)" count={`${f.events.length}件`}>
          {f.events.length ? (
            <ul className="space-y-0.5 text-slate-600">
              {f.events.map((e, i) => (
                <li key={i}>
                  {jp(e.date)} {e.title} 出席{e.yes}人{e.pending ? `・まだ答えていない${e.pending}人` : ""}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-slate-500">近いイベントはありません</p>
          )}
        </Card>
        <Card href="/applicants" title="採用" count={`面接 ${f.interviewsToday}件`} tone={f.applicantsWaiting ? "rose" : f.interviewsToday ? "amber" : "slate"}>
          {f.applicantsWaiting > 0 && <p className="text-rose-700">返事をしていない応募者が{f.applicantsWaiting}人</p>}
        </Card>
        <Card href="/licenses" title="資格・免許" count={`${f.licenseAlerts}件`} tone={f.licenseAlerts ? "rose" : "slate"}>
          <p className="text-slate-500">{f.licenseAlerts ? "期限が近い・切れた・運転免許を確かめられない人がいます" : "気になるものはありません"}</p>
        </Card>
        <Card href="/health-checks" title="健康診断" count={`${f.healthDue + f.healthFollowUps}人`} tone={f.healthDue ? "rose" : f.healthFollowUps ? "amber" : "slate"}>
          <p className="text-slate-500">{f.healthDue || f.healthFollowUps ? [f.healthDue ? `受けていない・予約日を過ぎた人が${f.healthDue}人` : "", f.healthFollowUps ? `再検査がまだの人が${f.healthFollowUps}人` : ""].filter(Boolean).join("・") : "気になるものはありません"}</p>
        </Card>
        <Card href="/stockpile" title="防災の備蓄品の期限" count={`${f.stockAlerts}件`} tone={f.stockAlerts ? "amber" : "slate"} />
        <Card href="/vehicles" title="社用車の車検・保険・点検" count={`${f.vehicleAlerts}台`} tone={f.vehicleAlerts ? "amber" : "slate"} />
        <Card href="/gifts" title="お礼がまだの贈答品" count={`${f.unthankedGifts}件`} tone={f.unthankedGifts ? "amber" : "slate"} />
        <Card href="/handover" title="今日お休みの人" count={`${f.offToday.length}人`}>
          <p className="text-slate-600">{f.offToday.length ? f.offToday.map((n) => `${n}さん`).join("・") : "いません"}</p>
        </Card>
      </div>
    </div>
  );
}

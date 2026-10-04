import Link from "next/link";
import { headers } from "next/headers";
import { requireUser } from "@/lib/auth/session";
import { companyBilling } from "@/lib/billing";
import { plans } from "@/lib/billing/plans";
import { formatYen } from "@/lib/format";
import { BillingButton } from "./BillingButtons";

export const dynamic = "force-dynamic";

const date = (d: Date) => new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "long", day: "numeric" }).format(d);

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ success?: string }> }) {
  const user = await requireUser();
  const { company, state } = await companyBilling(user.companyId);
  const { success } = await searchParams;
  // スマホアプリの中では申し込みの案内をしない(App Store の決まり。手続きはブラウザで)
  const nativeApp = ((await headers()).get("user-agent") ?? "").includes("StaffAppNative");
  const list = Object.values(plans());
  const current = state.plan ? plans()[state.plan] : null;
  const admin = user.role === "ADMIN";

  const status = {
    off: { tone: "bg-slate-100 text-slate-700", text: "有料プランの準備中です(今はすべての機能を無料で使えます)" },
    free: { tone: "bg-emerald-50 text-emerald-800", text: "この会社は無料でご利用いただけます" },
    trial: { tone: "bg-indigo-50 text-indigo-800", text: `無料期間中です(あと${state.daysLeft}日・${date(state.trialEndsAt)}まで)` },
    active: { tone: "bg-emerald-50 text-emerald-800", text: `${current?.name ?? ""}プランをご契約中です` },
    past_due: { tone: "bg-amber-50 text-amber-900", text: "お支払いができませんでした。カードの情報を確かめてください" },
    expired: { tone: "bg-rose-50 text-rose-800", text: "無料期間が終わりました。続けて使うには有料プランにお申し込みください" },
  }[state.phase];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">契約・お支払い</h1>
        <p className="mt-1 text-sm text-slate-600">{company.name}のご契約の状態です。</p>
      </div>

      {success && <div className="rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-800">お申し込みありがとうございます。反映まで1分ほどかかることがあります(表示が変わらないときは、少し待ってから開き直してください)。</div>}

      <section className={`rounded-xl px-5 py-4 ${status.tone}`}>
        <p className="font-medium">{status.text}</p>
        {state.phase === "active" && state.currentPeriodEnd && (
          <p className="mt-1 text-sm">
            {state.cancelAtPeriodEnd ? `解約の手続き済みです。${date(state.currentPeriodEnd)}まで使えます。` : `次回の更新日: ${date(state.currentPeriodEnd)}`}
          </p>
        )}
      </section>

      {!admin ? (
        <p className="text-sm text-slate-600">
          契約・お支払いの手続きは、会社の管理者が行います。{state.phase === "expired" && "続けて使うには、会社の管理者に契約を頼んでください。"}
        </p>
      ) : nativeApp ? (
        <p className="text-sm text-slate-600">契約・お支払いの手続きは、パソコンなどのブラウザでログインして行ってください。</p>
      ) : state.phase === "off" ? (
        <p className="text-sm text-slate-600">運営者の方へ: Stripe のキーと価格を環境変数に設定すると、ここから申し込めるようになります(README の「有料プランの設定」)。</p>
      ) : state.phase === "free" ? null : (
        <>
          {(state.phase === "active" || state.phase === "past_due") && company.stripeCustomerId ? (
            <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="font-semibold">お支払い情報の管理</h2>
              <p className="text-sm text-slate-600">カードの変更、プランの変更(ライト⇔スタンダード)、領収書のダウンロード、解約ができます(Stripe の画面が開きます)。</p>
              <div className="sm:w-64">
                <BillingButton action="portal" label="お支払い情報の管理" />
              </div>
            </section>
          ) : (
            <section className="space-y-3">
              <h2 className="font-semibold">プランを選んで申し込む</h2>
              {state.phase === "trial" && <p className="text-sm text-slate-600">いま申し込んでも、無料期間が終わる{date(state.trialEndsAt)}までは料金はかかりません。</p>}
              <div className="grid gap-4 sm:grid-cols-2">
                {list.map((p) => (
                  <div key={p.key} className="flex flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                    <h3 className="text-lg font-semibold">{p.name}</h3>
                    <p className="text-xs text-slate-500">{p.summary}</p>
                    <p className="mt-2 text-2xl font-semibold tabular-nums">
                      {formatYen(p.price)}
                      <span className="text-sm font-normal text-slate-500"> / 月(税込)</span>
                    </p>
                    <ul className="mt-3 flex-1 space-y-1 text-sm text-slate-700">
                      {p.features.map((f) => (
                        <li key={f}>✓ {f}</li>
                      ))}
                    </ul>
                    <div className="mt-4">
                      <BillingButton action="checkout" plan={p.key} label={`${p.name}で申し込む`} />
                    </div>
                  </div>
                ))}
              </div>
              {company.stripeCustomerId && (
                <div className="sm:w-64">
                  <BillingButton action="portal" label="領収書・お支払い履歴" primary={false} />
                </div>
              )}
            </section>
          )}
        </>
      )}

      {state.phase === "expired" && (
        <section className="space-y-1 rounded-xl border border-slate-200 bg-white p-5 text-sm shadow-sm">
          <h2 className="font-semibold">データの持ち出し</h2>
          <p className="text-slate-600">契約しなくても、これまでのデータはダウンロードできます。</p>
          <p>
            <Link href="/backup" className="text-indigo-700 hover:underline">
              データのバックアップ
            </Link>
            <span className="mx-2 text-slate-300">|</span>
            <Link href="/accountant-export" className="text-indigo-700 hover:underline">
              税理士向けデータ
            </Link>
          </p>
        </section>
      )}

      <p className="text-xs text-slate-500">
        お支払いはクレジットカード(Stripe)です。いつでも解約でき、解約しても契約期間の終わりまで使えます(日割りの返金はありません)。くわしくは
        <Link href="/pricing" className="mx-1 text-indigo-700 hover:underline">
          料金プラン
        </Link>
        と
        <Link href="/tokushoho" className="mx-1 text-indigo-700 hover:underline">
          特定商取引法に基づく表記
        </Link>
        をご覧ください。
      </p>
    </div>
  );
}

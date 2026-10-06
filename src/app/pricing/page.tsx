import Link from "next/link";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { AI_MODE_INFO, plans, TRIAL_DAYS } from "@/lib/billing/plans";
import { formatYen } from "@/lib/format";
import { LegalLinks } from "@/components/LegalLinks";

export const metadata: Metadata = { title: "料金プラン | AI経理オートメーション" };

const FAQ = [
  { q: "無料期間のあとは自動で課金されますか?", a: `いいえ。登録から${TRIAL_DAYS}日間は無料で、カードの登録も要りません。続けて使うときに、管理者が「契約・お支払い」から申し込みます。申し込まなければ料金はかかりません。` },
  { q: "途中でプランを変えられますか?", a: "はい。「契約・お支払い」→「お支払い情報の管理」から、いつでもライトとスタンダードを切り替えられます。料金は日割りで調整されます。" },
  { q: "解約するとデータはどうなりますか?", a: "解約しても、契約期間の終わりまではそのまま使えます。期間が終わったあとも、データのバックアップ(CSV)はダウンロードできます。" },
  { q: "従業員の人数で料金は変わりますか?", a: "変わりません。スタッフアプリ・経費精算・タイムカードを使う従業員は、どのプランでも人数無制限です。ライトプランは、管理者・経理担当が2人までです。" },
  { q: "AI込みとAI持ち込みの違いは?", a: "使える機能は同じです。AI込みはこのサービスのAIを使い、AIの利用料が月額に含まれます。AI持ち込みは、自社で契約したAI(Anthropic の API キー)を使うので月額がお安くなり、AIの利用料は自社でお支払いいただきます。" },
  { q: "支払い方法は?", a: "クレジットカード(Visa・Mastercard・JCB・American Express など)です。お支払いは Stripe(決済サービス)を通して安全に行われ、カード番号は当社には保存されません。" },
];

export default async function PricingPage() {
  // スマホアプリの中では料金・申し込みの案内を出さない(App Store の決まり)
  const nativeApp = ((await headers()).get("user-agent") ?? "").includes("StaffAppNative");
  if (nativeApp) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 py-6">
        <h1 className="text-2xl font-semibold">料金プラン</h1>
        <p className="text-sm text-slate-600">料金・契約については、パソコンなどのブラウザでご確認ください。</p>
        <LegalLinks />
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-4xl space-y-8 py-6">
      <div className="text-center">
        <h1 className="text-3xl font-semibold">料金プラン</h1>
        <p className="mt-2 text-slate-600">
          会計・請求書・経費精算・給与・勤怠・スタッフアプリまで、すべての機能が使えます。まずは{TRIAL_DAYS}日間、無料でお試しください(カードの登録は不要です)。
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {Object.values(plans()).map((p) => (
          <section key={p.key} className={`flex flex-col rounded-2xl border bg-white p-6 shadow-sm ${p.key === "STANDARD" ? "border-indigo-300 ring-1 ring-indigo-200" : "border-slate-200"}`}>
            <h2 className="text-xl font-semibold">{p.name}</h2>
            <p className="text-sm text-slate-500">{p.summary}</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-indigo-50 px-3 py-2">
                <p className="text-xs font-medium text-indigo-800">{AI_MODE_INFO.INCLUDED.name}</p>
                <p className="text-2xl font-semibold tabular-nums">
                  {formatYen(p.price)}
                  <span className="text-xs font-normal text-slate-500"> / 月</span>
                </p>
              </div>
              <div className="rounded-lg bg-slate-50 px-3 py-2">
                <p className="text-xs font-medium text-slate-600">{AI_MODE_INFO.BYO.name}</p>
                <p className="text-2xl font-semibold tabular-nums">
                  {formatYen(p.byoPrice)}
                  <span className="text-xs font-normal text-slate-500"> / 月</span>
                </p>
              </div>
            </div>
            <p className="mt-1 text-xs text-slate-500">金額は税込です。</p>
            <ul className="mt-4 flex-1 space-y-1.5 text-sm text-slate-700">
              {p.features.map((f) => (
                <li key={f}>✓ {f}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <section className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-5 text-sm shadow-sm sm:grid-cols-2">
        <div>
          <h2 className="font-semibold">{AI_MODE_INFO.INCLUDED.name}</h2>
          <p className="mt-1 text-slate-600">{AI_MODE_INFO.INCLUDED.summary}。AIのキーの用意は要りません。</p>
        </div>
        <div>
          <h2 className="font-semibold">{AI_MODE_INFO.BYO.name}</h2>
          <p className="mt-1 text-slate-600">{AI_MODE_INFO.BYO.summary}。キーは「AIの設定」で登録し、暗号化して保存します。</p>
        </div>
      </section>

      <div className="text-center">
        <Link href="/login" className="inline-block rounded-md bg-indigo-600 px-6 py-3 font-medium text-white shadow-sm hover:bg-indigo-700">
          {TRIAL_DAYS}日間無料ではじめる
        </Link>
        <p className="mt-2 text-xs text-slate-500">ログイン画面の「はじめての方」から会社を登録できます。</p>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">よくある質問</h2>
        {FAQ.map((f) => (
          <details key={f.q} className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm">
            <summary className="cursor-pointer font-medium">{f.q}</summary>
            <p className="mt-2 text-slate-600">{f.a}</p>
          </details>
        ))}
      </section>
      <LegalLinks />
    </div>
  );
}

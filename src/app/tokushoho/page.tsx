import Link from "next/link";
import type { Metadata } from "next";
import { operator } from "@/lib/legal";
import { plans, TRIAL_DAYS } from "@/lib/billing/plans";
import { formatYen } from "@/lib/format";
import { LegalLinks } from "@/components/LegalLinks";

export const metadata: Metadata = { title: "特定商取引法に基づく表記 | AI経理オートメーション" };

// 運営者の情報は環境変数(SERVICE_OPERATOR_NAME など)から。住所・電話番号を出さない場合は「請求があれば開示」と表示する
const ON_REQUEST = "請求があったときは、遅滞なく開示します(上記メールアドレスまでご連絡ください)";

export default function TokushohoPage() {
  const op = operator();
  const p = plans();
  const rows: [string, React.ReactNode][] = [
    ["販売事業者", op.name],
    ["運営統括責任者", op.representative ?? ON_REQUEST],
    ["所在地", op.address ?? ON_REQUEST],
    ["電話番号", op.phone ?? ON_REQUEST],
    ["メールアドレス", op.contact ?? "準備中"],
    [
      "販売価格",
      <>
        {Object.values(p).map((x) => (
          <span key={x.key} className="block">
            {x.name}プラン: 月額 {formatYen(x.price)}(税込)
          </span>
        ))}
        <Link href="/pricing" className="text-indigo-700 underline">
          料金プラン
        </Link>
        のページもご覧ください。
      </>,
    ],
    ["商品代金以外の必要料金", "インターネットの接続料金・通信料金は、お客様のご負担となります。"],
    ["お支払い方法", "クレジットカード(決済は Stripe, Inc. の決済サービスを利用します)"],
    ["お支払い時期", `お申し込み時にお支払いが確定し、以後は毎月同じ日に自動で更新・お支払いとなります。無料期間(登録から${TRIAL_DAYS}日間)中にお申し込みいただいた場合は、無料期間の終了時に初回のお支払いとなります。`],
    ["サービスの提供時期", "お支払いの手続きが完了した時点から、すぐにご利用いただけます。"],
    ["解約・返品について", "サービスの性質上、お支払い後の返金はいたしません。解約はいつでも「契約・お支払い」の画面からでき、解約後も契約期間の終わりまでご利用いただけます(日割りの返金はありません)。"],
    ["動作環境", "最新版の Google Chrome・Microsoft Edge・Safari・Firefox。スマートフォンのスタッフアプリは iOS・Android に対応しています。"],
  ];
  return (
    <div className="mx-auto max-w-3xl space-y-4 py-6">
      <h1 className="text-2xl font-semibold">特定商取引法に基づく表記</h1>
      {!op.configured && <p className="rounded-md bg-amber-50 px-4 py-2 text-sm text-amber-900">運営者の情報がまだ設定されていません(環境変数 SERVICE_OPERATOR_NAME など)。</p>}
      <dl className="divide-y overflow-hidden rounded-xl border border-slate-200 bg-white text-sm shadow-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="grid gap-1 px-4 py-3 sm:grid-cols-[12rem_1fr] sm:gap-4">
            <dt className="font-medium text-slate-600">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <LegalLinks />
    </div>
  );
}

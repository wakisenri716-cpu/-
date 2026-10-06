import Link from "next/link";
import type { Metadata } from "next";
import { operator } from "@/lib/legal";
import { LegalLinks } from "@/components/LegalLinks";
import { getCurrentUser } from "@/lib/auth/session";
import { SupportForm } from "./SupportForm";

export const metadata: Metadata = { title: "サポート・お問い合わせ | Clerkly" };

const FAQ = [
  {
    q: "ログインできません",
    a: "メールアドレスとパスワードを確かめてください。パスワードを忘れたときは、ログイン画面の「パスワードを忘れた方」から再設定できます。アカウントは会社の管理者が作るので、まだアカウントがない方は会社の管理者に頼んでください。",
  },
  {
    q: "スタッフアプリにシフトが出てきません",
    a: "会社の管理者に、「シフト管理」でスタッフとして登録し、あなたのアカウントとひも付けてもらってください。",
  },
  {
    q: "カメラが使えません",
    a: "iPhoneは「設定」→「スタッフアプリ」→「カメラ」、Androidは「設定」→「アプリ」→「スタッフアプリ」→「権限」で、カメラを許可してください。",
  },
  {
    q: "アカウントを削除したい",
    a: "アカウントは会社の管理者が「ユーザー管理」で利用停止・削除できます。会社の管理者に頼めないときは、下のお問い合わせ先にご連絡ください。ご本人であることを確かめたうえで削除します。",
  },
  {
    q: "使い方を知りたい",
    a: "画面の写真つきの「使い方ガイド」をご覧ください。",
  },
];

// サポート・お問い合わせ(ログインしなくても見られる。App Store・Google Play のサポートURLにも使う)
export default async function SupportPage() {
  const op = operator();
  const user = await getCurrentUser();
  return (
    <div className="mx-auto max-w-2xl space-y-6 py-4">
      <div>
        <h1 className="text-2xl font-semibold">サポート・お問い合わせ</h1>
        <p className="mt-1 text-sm text-slate-600">Clerkly(パソコン・スマホのスタッフアプリ)のサポート窓口です。</p>
      </div>

      <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-semibold">お問い合わせ先</h2>
        <dl className="grid grid-cols-[6rem_1fr] gap-y-1 text-sm">
          <dt className="text-slate-500">運営者</dt>
          <dd>{op.name}</dd>
          <dt className="text-slate-500">メール</dt>
          <dd>{op.contact ? <a href={`mailto:${op.contact}`} className="text-indigo-700 hover:underline">{op.contact}</a> : "準備中(会社の管理者にお問い合わせください)"}</dd>
          {op.address && (
            <>
              <dt className="text-slate-500">所在地</dt>
              <dd>{op.address}</dd>
            </>
          )}
        </dl>
        <p className="text-xs text-slate-500">いただいたお問い合わせには、通常3営業日以内にメールでお返事します。</p>
      </section>

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-semibold">お問い合わせフォーム</h2>
        <SupportForm name={user?.name} email={user?.email} />
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">よくある質問</h2>
        {FAQ.map((f) => (
          <details key={f.q} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <summary className="cursor-pointer font-medium">{f.q}</summary>
            <p className="mt-2 text-sm leading-relaxed text-slate-700">{f.a}</p>
            {f.q === "使い方を知りたい" && (
              <Link href="/guide" className="mt-2 inline-block text-sm text-indigo-700 hover:underline">
                使い方ガイドを開く →
              </Link>
            )}
          </details>
        ))}
      </section>
      <LegalLinks />
    </div>
  );
}

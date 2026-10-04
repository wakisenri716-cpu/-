import Link from "next/link";
import { headers } from "next/headers";
import { getCurrentUser } from "@/lib/auth/session";
import { LogoutButton } from "@/components/LogoutButton";
import { PushSettings } from "./PushSettings";
import { BookIcon, ClockIcon, KeyIcon, MegaphoneIcon, NotebookIcon, ReceiptIcon, StampIcon } from "@/components/icons";

const LINKS = [
  { href: "/timeclock", label: "タイムカード", icon: ClockIcon },
  { href: "/expenses", label: "経費精算(レシート)", icon: ReceiptIcon },
  { href: "/requests", label: "申請・稟議(有給など)", icon: StampIcon },
  { href: "/notices", label: "社内のお知らせ", icon: MegaphoneIcon },
  { href: "/worklogs", label: "日報(工数)", icon: NotebookIcon },
  { href: "/account", label: "アカウント・パスワード", icon: KeyIcon },
  { href: "/guide", label: "使い方ガイド", icon: BookIcon },
];

export default async function StaffMore() {
  const user = await getCurrentUser();
  // スマホアプリ(mobile/ の Capacitor)から開いているときは、ホーム画面に追加の説明はいらない
  const nativeApp = ((await headers()).get("user-agent") ?? "").includes("StaffAppNative");
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">その他</h1>
        <p className="text-sm text-slate-500">{user?.name}さんとしてログイン中</p>
      </div>
      <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        {LINKS.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className="flex items-center gap-3 px-4 py-3.5 text-sm">
              <l.icon className="h-5 w-5 text-indigo-600" />
              <span className="flex-1">{l.label}</span>
              <span className="text-slate-300">›</span>
            </Link>
          </li>
        ))}
      </ul>
      <PushSettings />
      {!nativeApp && (
        <section className="space-y-2 rounded-2xl bg-white p-4 text-sm shadow-sm ring-1 ring-slate-200">
          <h2 className="font-semibold">ホーム画面に追加して、アプリのように使う</h2>
          <p className="text-slate-600">
            <strong>iPhone</strong>: Safariで開き、下の共有ボタン(□に↑)→「ホーム画面に追加」
          </p>
          <p className="text-slate-600">
            <strong>Android</strong>: Chromeで開き、右上の「︙」→「ホーム画面に追加」(または「アプリをインストール」)
          </p>
        </section>
      )}
      <div className="text-center">
        <LogoutButton />
      </div>
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { getCurrentUser } from "@/lib/auth";
import { LogoutButton } from "@/components/LogoutButton";

export const metadata: Metadata = {
  title: "AI経理オートメーション",
  description: "経費精算・請求書処理をAIが半自動化する統合SaaS基盤",
};

const NAV_ITEMS = [
  { href: "/", label: "ダッシュボード" },
  { href: "/expenses", label: "経費精算" },
  { href: "/invoices", label: "請求書" },
  { href: "/review", label: "レビューキュー" },
  { href: "/ledger", label: "総勘定元帳" },
  { href: "/trial-balance", label: "試算表" },
];

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const user = await getCurrentUser();

  return (
    <html lang="ja" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-slate-50 text-slate-900">
        <header className="border-b bg-white">
          <div className="mx-auto flex max-w-5xl items-center gap-6 px-4 py-3">
            <span className="font-semibold text-lg">AI経理オートメーション</span>
            {user && (
              <nav className="flex gap-4 text-sm">
                {NAV_ITEMS.map((item) => (
                  <Link key={item.href} href={item.href} className="text-slate-600 hover:text-slate-900">
                    {item.label}
                  </Link>
                ))}
              </nav>
            )}
            {user && (
              <div className="ml-auto flex items-center gap-3 text-sm">
                <span className="text-slate-500">{user.name} さんとしてログイン中</span>
                <LogoutButton />
              </div>
            )}
          </div>
        </header>
        <main className="flex-1 mx-auto w-full max-w-5xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}

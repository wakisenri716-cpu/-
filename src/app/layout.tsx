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
          <div className="mx-auto max-w-5xl px-4 py-3">
            <div className="flex items-center justify-between gap-4">
              <span className="font-semibold text-lg whitespace-nowrap">AI経理オートメーション</span>
              {user && (
                <div className="flex shrink-0 items-center gap-3 text-sm">
                  <span className="hidden text-slate-500 sm:inline">{user.name} さんとしてログイン中</span>
                  <LogoutButton />
                </div>
              )}
            </div>
            {user && (
              <nav className="-mx-4 mt-2 flex gap-4 overflow-x-auto px-4 text-sm sm:mx-0 sm:mt-1 sm:px-0">
                {NAV_ITEMS.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="shrink-0 whitespace-nowrap text-slate-600 hover:text-slate-900"
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
            )}
          </div>
        </header>
        <main className="flex-1 mx-auto w-full max-w-5xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}

import type { Metadata, Viewport } from "next";
import "./globals.css";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { EMPLOYEE_PATHS, getCurrentUser } from "@/lib/auth/session";
import { Sidebar, MobileNav } from "@/components/Sidebar";
import { LogoutButton } from "@/components/LogoutButton";
import { CompanySwitcher } from "@/components/CompanySwitcher";
import { listMyCompanies } from "@/lib/auth/companies";

export const metadata: Metadata = {
  title: "AI経理オートメーション",
  description: "経費精算・請求書処理をAIが半自動化する統合SaaS基盤",
  // iPhone・iPad の「ホーム画面に追加」用(Android などは manifest.ts を使う)
  appleWebApp: { capable: true, title: "経理AI", statusBarStyle: "default" },
  icons: { apple: "/pwa-icon/180" },
};

export const viewport: Viewport = {
  themeColor: "#4f46e5",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const user = await getCurrentUser();
  const pathname = (await headers()).get("x-pathname") ?? "/";
  // 会社で2段階認証を必須にしていて、まだ設定していない人は、設定するまでアカウント画面だけ
  if (user?.mustSetup2fa && pathname !== "/account") redirect("/account?require2fa=1");
  if (user?.role === "EMPLOYEE") {
    if (!EMPLOYEE_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) redirect("/expenses");
  }

  const companies = user ? await listMyCompanies(user.id) : [];

  return (
    <html lang="ja" className="h-full antialiased">
      <body className="min-h-full bg-slate-50 text-slate-900 print:bg-white">
        {user ? (
          <div className="flex min-h-screen">
            <Sidebar userName={user.name} role={user.role} companies={companies} companyId={user.companyId} />
            <div className="flex min-w-0 flex-1 flex-col">
              <header className="border-b bg-white px-4 py-3 md:hidden print:hidden">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-sm font-semibold whitespace-nowrap">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-xs font-bold text-white">
                      AI
                    </span>
                    経理オートメーション
                  </span>
                  <LogoutButton />
                </div>
                {companies.length > 1 && (
                  <div className="mt-2">
                    <CompanySwitcher companies={companies} current={user.companyId} compact />
                  </div>
                )}
                <div className="mt-2">
                  <MobileNav role={user.role} />
                </div>
              </header>
              <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 lg:px-8 print:max-w-none print:p-0">
                {user.mustSetup2fa && (
                  <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    会社の設定で、2段階認証が必須になっています。下の「2段階認証」を設定すると、ほかの画面が使えるようになります。
                  </div>
                )}
                {children}
              </main>
            </div>
          </div>
        ) : (
          <main className="mx-auto w-full max-w-5xl px-4 py-6">{children}</main>
        )}
      </body>
    </html>
  );
}

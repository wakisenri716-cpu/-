import type { Metadata, Viewport } from "next";
import "./globals.css";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { EMPLOYEE_PATHS, getCurrentUser } from "@/lib/auth/session";
import { Sidebar, MobileNav } from "@/components/Sidebar";
import { LogoutButton } from "@/components/LogoutButton";

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
  if (user?.role === "EMPLOYEE") {
    const pathname = (await headers()).get("x-pathname") ?? "/";
    if (!EMPLOYEE_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) redirect("/expenses");
  }

  return (
    <html lang="ja" className="h-full antialiased">
      <body className="min-h-full bg-slate-50 text-slate-900 print:bg-white">
        {user ? (
          <div className="flex min-h-screen">
            <Sidebar userName={user.name} role={user.role} />
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
                <div className="mt-2">
                  <MobileNav role={user.role} />
                </div>
              </header>
              <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 lg:px-8 print:max-w-none print:p-0">{children}</main>
            </div>
          </div>
        ) : (
          <main className="mx-auto w-full max-w-5xl px-4 py-6">{children}</main>
        )}
      </body>
    </html>
  );
}

import type { Metadata, Viewport } from "next";
import { Inter, Noto_Sans_JP } from "next/font/google";
import "./globals.css";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { EMPLOYEE_PATHS, OPEN_PATHS, getCurrentUser } from "@/lib/auth/session";
import { Sidebar, MobileNav } from "@/components/Sidebar";
import { NativePush } from "@/components/NativePush";
import { CompanySwitcher } from "@/components/CompanySwitcher";
import { listMyCompanies } from "@/lib/auth/companies";
import { BILLING_OPEN_PATHS, isFreeCompany } from "@/lib/billing";
import { BillingBanner } from "@/components/BillingBanner";
import { isOperator } from "@/lib/operator";
import { VerifyEmailBanner } from "@/components/VerifyEmailBanner";
import { ServiceNotices } from "@/components/ServiceNotices";
import { DemoBanner } from "@/components/DemoControls";
import { activeNotices } from "@/lib/support";

// 欧文・数字は Inter、和文は Noto Sans JP(和文は文字数が多いので先読みしない)
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const notoJp = Noto_Sans_JP({ subsets: ["latin"], variable: "--font-noto-jp", display: "swap", preload: false });

export const metadata: Metadata = {
  title: "AI経理オートメーション",
  description: "経費精算・請求書処理をAIが半自動化する統合SaaS基盤",
  // iPhone・iPad の「ホーム画面に追加」用(Android などは manifest.ts を使う)
  appleWebApp: { capable: true, title: "経理AI", statusBarStyle: "default" },
  icons: { apple: "/pwa-icon/180" },
};

export const viewport: Viewport = {
  themeColor: "#5b4ae6",
  // スマホアプリ(mobile/)・ホーム画面に追加したときに画面いっぱいに表示し、余白は safe-area で取る
  viewportFit: "cover",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const user = await getCurrentUser();
  const headerList = await headers();
  const pathname = headerList.get("x-pathname") ?? "/";
  const open = OPEN_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  // 利用規約への同意・会社情報の入力がまだなら、ようこそ画面でまとめて済ませてもらう
  if (user && (user.needsTerms || user.needsCompanyInfo) && !open) redirect("/welcome");
  // 会社で2段階認証を必須にしていて、まだ設定していない人は、設定するまでアカウント画面だけ
  if (user?.mustSetup2fa && pathname !== "/account" && !open) redirect("/account?require2fa=1");
  if (user?.role === "EMPLOYEE") {
    if (!EMPLOYEE_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) redirect("/staff");
  }
  // 無料期間が終わって契約がない会社は、契約の画面へ(データの持ち出し・規約などは開ける)
  const billingOpen = open || BILLING_OPEN_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (user && !user.billing.access && !billingOpen && !(await isFreeCompany(user.companyId))) redirect("/billing");
  const nativeApp = (headerList.get("user-agent") ?? "").includes("StaffAppNative");

  const [companies, notices] = user ? await Promise.all([listMyCompanies(user.id), activeNotices()]) : [[], []];
  // スタッフアプリ(/staff)はスマホでアプリのように使うので、上のヘッダーを出さず下のタブで移動する
  const staffApp = pathname === "/staff" || pathname.startsWith("/staff/");

  return (
    <html lang="ja" className={`h-full antialiased ${inter.variable} ${notoJp.variable}`}>
      <body className="min-h-full bg-slate-50 text-slate-900 print:bg-white">
        {user ? (
          <div className="flex min-h-screen">
            <Sidebar userName={user.name} role={user.role} companies={companies} companyId={user.companyId} operator={isOperator(user.email)} />
            <div className="flex min-w-0 flex-1 flex-col">
              <header className={`sticky top-0 z-30 border-b border-slate-200/80 bg-white/85 px-4 py-2.5 backdrop-blur md:hidden print:hidden ${staffApp ? "hidden" : ""}`}>
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-sm font-bold whitespace-nowrap text-slate-900">
                    <span className="flex h-7 w-7 items-center justify-center rounded-[9px] bg-linear-to-br from-indigo-500 to-violet-600 text-xs font-bold text-white shadow-sm shadow-indigo-500/30">
                      AI
                    </span>
                    経理オートメーション
                  </span>
                  <MobileNav role={user.role} />
                </div>
                {companies.length > 1 && (
                  <div className="mt-2">
                    <CompanySwitcher companies={companies} current={user.companyId} compact />
                  </div>
                )}
              </header>
              <main className={`mx-auto w-full max-w-5xl flex-1 px-4 sm:px-6 lg:px-8 print:max-w-none print:p-0 ${staffApp ? "pt-4 pb-24 md:py-6" : "py-6"}`}>
                {user.mustSetup2fa && (
                  <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    会社の設定で、2段階認証が必須になっています。下の「2段階認証」を設定すると、ほかの画面が使えるようになります。
                  </div>
                )}
                {notices.length > 0 && <ServiceNotices notices={notices} />}
                {user.isDemoCompany && <DemoBanner />}
                {user.role === "ADVISOR" && (
                  <div className="mb-4 rounded-xl border border-sky-200 bg-sky-50 px-4 py-2.5 text-sm text-sky-900 print:hidden">
                    税理士(閲覧のみ)としてログインしています。帳簿・書類は見られますが、データの変更はできません。気になる仕訳には、仕訳帳の「コメント」で質問できます。
                  </div>
                )}
                {user.needsEmailVerify && <VerifyEmailBanner email={user.email} />}
                {user.role === "ADMIN" && !nativeApp && <BillingBanner billing={user.billing} companyId={user.companyId} />}
                {children}
              </main>
            </div>
            <NativePush />
          </div>
        ) : (
          <main className="mx-auto w-full max-w-5xl px-4 py-6">{children}</main>
        )}
      </body>
    </html>
  );
}

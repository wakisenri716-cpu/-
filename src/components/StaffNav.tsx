"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BoxIcon, CalendarIcon, DashboardIcon, NotebookIcon, ReceiptIcon } from "@/components/icons";

const TABS = [
  { href: "/staff", label: "ホーム", icon: DashboardIcon },
  { href: "/staff/shifts", label: "シフト", icon: CalendarIcon },
  { href: "/staff/stock", label: "在庫", icon: BoxIcon },
  { href: "/staff/manuals", label: "マニュアル", icon: NotebookIcon },
  { href: "/staff/more", label: "その他", icon: ReceiptIcon },
];

const active = (pathname: string, href: string) => (href === "/staff" ? pathname === "/staff" : pathname === href || pathname.startsWith(`${href}/`));

// スタッフアプリの移動: スマホは画面の下のタブ、パソコンは上のタブ
export function StaffNav() {
  const pathname = usePathname();
  return (
    <>
      <nav className="mb-4 hidden gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm md:flex print:hidden" aria-label="スタッフアプリ">
        {TABS.map((t) => (
          <Link key={t.href} href={t.href} className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm ${active(pathname, t.href) ? "bg-indigo-600 font-medium text-white" : "text-slate-600 hover:bg-slate-50"}`}>
            <t.icon className="h-4 w-4" />
            {t.label}
          </Link>
        ))}
      </nav>
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden print:hidden" aria-label="スタッフアプリ">
        <ul className="mx-auto flex max-w-md">
          {TABS.map((t) => {
            const on = active(pathname, t.href);
            return (
              <li key={t.href} className="flex-1">
                <Link href={t.href} className={`flex flex-col items-center gap-0.5 py-2 text-[11px] ${on ? "font-semibold text-indigo-600" : "text-slate-500"}`} aria-current={on ? "page" : undefined}>
                  <t.icon className="h-6 w-6" />
                  {t.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}

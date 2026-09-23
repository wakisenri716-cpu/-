"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArchiveIcon,
  BookIcon,
  ChartIcon,
  ClipboardIcon,
  DashboardIcon,
  DocumentIcon,
  InboxIcon,
  ReceiptIcon,
  RegisterIcon,
  ScaleIcon,
  UsersIcon,
} from "@/components/icons";
import { LogoutButton } from "@/components/LogoutButton";
import type { ComponentType, SVGProps } from "react";

type NavItem = { href: string; label: string; icon: ComponentType<SVGProps<SVGSVGElement>> };
type NavSection = { title?: string; items: NavItem[] };

export const NAV_SECTIONS: NavSection[] = [
  { items: [{ href: "/", label: "ダッシュボード", icon: DashboardIcon }] },
  {
    title: "業務",
    items: [
      { href: "/expenses", label: "経費精算", icon: ReceiptIcon },
      { href: "/invoices", label: "請求書", icon: DocumentIcon },
      { href: "/vendors", label: "取引先・顧客", icon: UsersIcon },
      { href: "/review", label: "レビューキュー", icon: InboxIcon },
      { href: "/pos", label: "POSレジ連携", icon: RegisterIcon },
      { href: "/assets", label: "固定資産", icon: ArchiveIcon },
    ],
  },
  {
    title: "帳票",
    items: [
      { href: "/ledger", label: "総勘定元帳", icon: BookIcon },
      { href: "/trial-balance", label: "試算表", icon: ScaleIcon },
      { href: "/income-statement", label: "損益計算書", icon: ChartIcon },
      { href: "/balance-sheet", label: "貸借対照表", icon: ClipboardIcon },
    ],
  },
];

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
        active ? "bg-indigo-50 text-indigo-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
      }`}
    >
      <Icon className={`h-5 w-5 shrink-0 ${active ? "text-indigo-600" : "text-slate-400"}`} />
      {item.label}
    </Link>
  );
}

export function Sidebar({ userName }: { userName: string }) {
  const pathname = usePathname();

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r bg-white md:flex">
      <div className="flex items-center gap-2 px-5 py-4">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">
          AI
        </span>
        <span className="text-sm font-semibold text-slate-900">経理オートメーション</span>
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-2">
        {NAV_SECTIONS.map((section, i) => (
          <div key={section.title ?? i}>
            {section.title && (
              <div className="px-3 pb-1.5 text-xs font-semibold tracking-wide text-slate-400">{section.title}</div>
            )}
            <div className="space-y-0.5">
              {section.items.map((item) => (
                <NavLink key={item.href} item={item} active={pathname === item.href} />
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t px-4 py-3">
        <div className="mb-2 truncate text-xs text-slate-500">{userName} さんとしてログイン中</div>
        <LogoutButton />
      </div>
    </aside>
  );
}

export function MobileNav() {
  const pathname = usePathname();
  const allItems = NAV_SECTIONS.flatMap((s) => s.items);

  return (
    <nav className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 text-sm md:hidden">
      {allItems.map((item) => {
        const Icon = item.icon;
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 whitespace-nowrap ${
              active ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600"
            }`}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

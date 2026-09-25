"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArchiveIcon,
  BankIcon,
  BookIcon,
  BuildingIcon,
  BoxIcon,
  CalendarIcon,
  CashflowIcon,
  ChecklistIcon,
  ClockIcon,
  CoinsIcon,
  ChartIcon,
  ClipboardIcon,
  DashboardIcon,
  DocumentIcon,
  HistoryIcon,
  InboxIcon,
  JournalIcon,
  KeyIcon,
  LockIcon,
  DownloadIcon,
  PercentIcon,
  QuoteIcon,
  ReceiptIcon,
  RegisterIcon,
  RepeatIcon,
  ScaleIcon,
  GaugeIcon,
  FolderIcon,
  FileIcon,
  MailIcon,
  SearchIcon,
  ShieldIcon,
  StoreIcon,
  TrendIcon,
  UsersIcon,
  WalletIcon,
} from "@/components/icons";
import { LogoutButton } from "@/components/LogoutButton";
import type { ComponentType, SVGProps } from "react";

type NavItem = { href: string; label: string; icon: ComponentType<SVGProps<SVGSVGElement>> };
type NavSection = { title?: string; items: NavItem[] };

export const NAV_SECTIONS: NavSection[] = [
  {
    items: [
      { href: "/", label: "ダッシュボード", icon: DashboardIcon },
      { href: "/review", label: "レビューキュー", icon: InboxIcon },
      { href: "/files", label: "書類フォルダ", icon: FolderIcon },
    ],
  },
  {
    title: "売上・取引先",
    items: [
      { href: "/quotes", label: "見積書", icon: QuoteIcon },
      { href: "/invoices", label: "請求書", icon: DocumentIcon },
      { href: "/receivables", label: "売掛金・買掛金", icon: CoinsIcon },
      { href: "/vendors", label: "取引先・顧客", icon: UsersIcon },
      { href: "/pos", label: "POSレジ連携", icon: RegisterIcon },
      { href: "/inventory", label: "在庫管理", icon: BoxIcon },
    ],
  },
  {
    title: "経費・お金",
    items: [
      { href: "/expenses", label: "経費精算", icon: ReceiptIcon },
      { href: "/reimbursements", label: "立替経費の精算", icon: WalletIcon },
      { href: "/bank", label: "銀行明細", icon: BankIcon },
      { href: "/recurring", label: "定期取引", icon: RepeatIcon },
      { href: "/cashflow", label: "資金繰り予測", icon: CashflowIcon },
      { href: "/calendar", label: "入金・支払カレンダー", icon: CalendarIcon },
      { href: "/assets", label: "固定資産", icon: ArchiveIcon },
    ],
  },
  {
    title: "人事・勤怠",
    items: [
      { href: "/shifts", label: "シフト管理", icon: CalendarIcon },
      { href: "/timeclock", label: "タイムカード", icon: ClockIcon },
      { href: "/attendance", label: "勤怠一覧", icon: ChecklistIcon },
    ],
  },
  {
    title: "帳票",
    items: [
      { href: "/journal", label: "仕訳帳", icon: JournalIcon },
      { href: "/ledger", label: "総勘定元帳", icon: BookIcon },
      { href: "/trial-balance", label: "試算表", icon: ScaleIcon },
      { href: "/income-statement", label: "損益計算書", icon: ChartIcon },
      { href: "/monthly", label: "月次推移・予算", icon: TrendIcon },
      { href: "/departments", label: "部門別損益", icon: StoreIcon },
      { href: "/balance-sheet", label: "貸借対照表", icon: ClipboardIcon },
      { href: "/financial-statements", label: "決算報告書", icon: FileIcon },
      { href: "/tax", label: "消費税集計", icon: PercentIcon },
      { href: "/analysis", label: "経営分析", icon: GaugeIcon },
      { href: "/documents", label: "証憑の検索", icon: SearchIcon },
    ],
  },
];

type Role = "ADMIN" | "ACCOUNTANT" | "EMPLOYEE";

const EMPLOYEE_SECTIONS: NavSection[] = [
  {
    title: "業務",
    items: [
      { href: "/expenses", label: "経費精算", icon: ReceiptIcon },
      { href: "/timeclock", label: "タイムカード", icon: ClockIcon },
    ],
  },
];

// 従業員には自分が使える画面だけを見せる(実際のアクセス制限はサーバー側で行う)
function sectionsFor(role: Role): NavSection[] {
  return [
    ...(role === "EMPLOYEE" ? EMPLOYEE_SECTIONS : NAV_SECTIONS),
    {
      title: "設定",
      items: [
        { href: "/account", label: "アカウント", icon: KeyIcon },
        ...(role === "EMPLOYEE"
          ? []
          : [
              { href: "/accounts", label: "勘定科目", icon: BookIcon },
              { href: "/closing", label: "締め処理", icon: LockIcon },
              { href: "/backup", label: "データのバックアップ", icon: DownloadIcon },
              { href: "/email", label: "メール設定・送信履歴", icon: MailIcon },
            ]),
        ...(role === "ADMIN"
          ? [
              { href: "/company", label: "会社情報", icon: BuildingIcon },
              { href: "/users", label: "ユーザー管理", icon: ShieldIcon },
              { href: "/audit", label: "操作ログ", icon: HistoryIcon },
            ]
          : []),
      ],
    },
  ];
}

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

export function Sidebar({ userName, role }: { userName: string; role: Role }) {
  const pathname = usePathname();

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r bg-white md:flex print:hidden">
      <div className="flex items-center gap-2 px-5 py-4">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">
          AI
        </span>
        <span className="text-sm font-semibold text-slate-900">経理オートメーション</span>
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-2">
        {sectionsFor(role).map((section, i) => (
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

export function MobileNav({ role }: { role: Role }) {
  const pathname = usePathname();
  const allItems = sectionsFor(role).flatMap((s) => s.items);

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

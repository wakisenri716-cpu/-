"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CompanySwitcher } from "./CompanySwitcher";
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
  CartIcon,
  BriefcaseIcon,
  MegaphoneIcon,
  ReceiptIcon,
  RegisterIcon,
  RepeatIcon,
  ScaleIcon,
  GaugeIcon,
  FolderIcon,
  FileIcon,
  LaptopIcon,
  NotebookIcon,
  PlaneIcon,
  SearchIcon,
  MailIcon,
  ShieldIcon,
  StampIcon,
  StoreIcon,
  SunIcon,
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
      { href: "/requests", label: "申請・稟議", icon: StampIcon },
      { href: "/notices", label: "社内のお知らせ", icon: MegaphoneIcon },
      { href: "/manuals", label: "マニュアル", icon: NotebookIcon },
      { href: "/staff", label: "スタッフアプリ", icon: DashboardIcon },
      { href: "/files", label: "書類フォルダ", icon: FolderIcon },
    ],
  },
  {
    title: "売上・取引先",
    items: [
      { href: "/deals", label: "商談管理", icon: TrendIcon },
      { href: "/quotes", label: "見積書", icon: QuoteIcon },
      { href: "/invoices", label: "請求書", icon: DocumentIcon },
      { href: "/purchase-orders", label: "発注書", icon: CartIcon },
      { href: "/receivables", label: "売掛金・買掛金", icon: CoinsIcon },
      { href: "/foreign", label: "外貨建ての取引", icon: CoinsIcon },
      { href: "/credit", label: "与信管理", icon: ShieldIcon },
      { href: "/vendors", label: "取引先・顧客", icon: UsersIcon },
      { href: "/letters", label: "宛名・送付状", icon: MailIcon },
      { href: "/pos", label: "POSレジ連携", icon: RegisterIcon },
      { href: "/inventory", label: "在庫管理", icon: BoxIcon },
    ],
  },
  {
    title: "経費・お金",
    items: [
      { href: "/expenses", label: "経費精算", icon: ReceiptIcon },
      { href: "/reimbursements", label: "立替経費の精算", icon: WalletIcon },
      { href: "/travel", label: "出張旅費・日当", icon: PlaneIcon },
      { href: "/transport", label: "交通費精算", icon: CashflowIcon },
      { href: "/duplicates", label: "二重計上のチェック", icon: SearchIcon },
      { href: "/advances", label: "仮払金", icon: CoinsIcon },
      { href: "/bank", label: "銀行・カード明細", icon: BankIcon },
      { href: "/cash-count", label: "現金の実査(金種表)", icon: CoinsIcon },
      { href: "/transfers", label: "振込データ", icon: CashflowIcon },
      { href: "/withholding", label: "源泉徴収・納付", icon: PercentIcon },
      { href: "/recurring", label: "定期取引", icon: RepeatIcon },
      { href: "/allocations", label: "期間按分", icon: CalendarIcon },
      { href: "/loans", label: "借入金", icon: BankIcon },
      { href: "/cashflow", label: "資金繰り予測", icon: CashflowIcon },
      { href: "/calendar", label: "入金・支払カレンダー", icon: CalendarIcon },
      { href: "/assets", label: "固定資産", icon: ArchiveIcon },
      { href: "/equipment", label: "備品管理", icon: LaptopIcon },
    ],
  },
  {
    title: "人事・勤怠",
    items: [
      { href: "/shifts", label: "シフト管理", icon: CalendarIcon },
      { href: "/shifts/requests", label: "シフト希望", icon: CalendarIcon },
      { href: "/timeclock", label: "タイムカード", icon: ClockIcon },
      { href: "/attendance", label: "勤怠一覧", icon: ChecklistIcon },
      { href: "/worklogs", label: "日報(工数)", icon: NotebookIcon },
      { href: "/leave", label: "有給・残業", icon: SunIcon },
      { href: "/payroll", label: "給与計算", icon: CoinsIcon },
      { href: "/bonus", label: "賞与", icon: CoinsIcon },
      { href: "/payroll/standard", label: "算定基礎(標準報酬)", icon: ShieldIcon },
      { href: "/year-end", label: "年末調整・源泉徴収票", icon: FileIcon },
      { href: "/staff-records", label: "労働者名簿・賃金台帳", icon: ClipboardIcon },
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
      { href: "/projects", label: "案件別損益", icon: BriefcaseIcon },
      { href: "/balance-sheet", label: "貸借対照表", icon: ClipboardIcon },
      { href: "/cash-flow-statement", label: "キャッシュ・フロー計算書", icon: TrendIcon },
      { href: "/financial-statements", label: "決算報告書", icon: FileIcon },
      { href: "/tax", label: "消費税集計", icon: PercentIcon },
      { href: "/tax/close", label: "消費税の決算整理", icon: PercentIcon },
      { href: "/corporate-tax", label: "法人税等の計算", icon: PercentIcon },
      { href: "/analysis", label: "経営分析", icon: GaugeIcon },
      { href: "/sales-analysis", label: "売上分析(ABC)", icon: ChartIcon },
      { href: "/documents", label: "証憑の検索", icon: SearchIcon },
      { href: "/compliance", label: "電子帳簿保存法", icon: ShieldIcon },
    ],
  },
];

type Role = "ADMIN" | "ACCOUNTANT" | "EMPLOYEE";

const EMPLOYEE_SECTIONS: NavSection[] = [
  {
    title: "スタッフアプリ",
    items: [
      { href: "/staff", label: "ホーム", icon: DashboardIcon },
      { href: "/staff/shifts", label: "シフト提出・確認", icon: CalendarIcon },
      { href: "/staff/stock", label: "在庫", icon: BoxIcon },
      { href: "/staff/manuals", label: "マニュアル", icon: NotebookIcon },
    ],
  },
  {
    title: "業務",
    items: [
      { href: "/timeclock", label: "タイムカード", icon: ClockIcon },
      { href: "/expenses", label: "経費精算", icon: ReceiptIcon },
      { href: "/travel", label: "出張旅費・日当", icon: PlaneIcon },
      { href: "/transport", label: "交通費精算", icon: CashflowIcon },
      { href: "/worklogs", label: "日報(工数)", icon: NotebookIcon },
      { href: "/requests", label: "申請・稟議", icon: StampIcon },
      { href: "/notices", label: "社内のお知らせ", icon: MegaphoneIcon },
    ],
  },
];

// 従業員には自分が使える画面だけを見せる(実際のアクセス制限はサーバー側で行う)
function sectionsFor(role: Role, operator = false): NavSection[] {
  return [
    ...(role === "EMPLOYEE" ? EMPLOYEE_SECTIONS : NAV_SECTIONS),
    {
      title: "設定",
      items: [
        { href: "/account", label: "アカウント", icon: KeyIcon },
        { href: "/guide", label: "使い方ガイド", icon: BookIcon },
        ...(role === "EMPLOYEE"
          ? []
          : [
              { href: "/accounts", label: "勘定科目", icon: BookIcon },
              { href: "/opening-balances", label: "開始残高(乗り換え)", icon: ScaleIcon },
              { href: "/monthly-close", label: "月次決算チェック", icon: ChecklistIcon },
              { href: "/closing", label: "締め処理", icon: LockIcon },
              { href: "/accountant-export", label: "税理士向けデータ", icon: FileIcon },
              { href: "/backup", label: "データのバックアップ", icon: DownloadIcon },
              { href: "/email", label: "メール設定・送信履歴", icon: MailIcon },
            ]),
        ...(role === "ADMIN"
          ? [
              { href: "/company", label: "会社情報", icon: BuildingIcon },
              { href: "/billing", label: "契約・お支払い", icon: CoinsIcon },
              { href: "/users", label: "ユーザー管理", icon: ShieldIcon },
              { href: "/security", label: "安全の設定", icon: LockIcon },
              { href: "/audit", label: "操作ログ", icon: HistoryIcon },
            ]
          : []),
      ],
    },
    // このサービスの運営者だけ(OPERATOR_EMAILS)
    ...(operator ? [{ title: "運営者", items: [{ href: "/operator", label: "運営者メニュー", icon: GaugeIcon }] }] : []),
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

export function Sidebar({ userName, role, companies, companyId, operator = false }: { userName: string; role: Role; companies: { id: string; name: string }[]; companyId: string; operator?: boolean }) {
  const pathname = usePathname();

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r bg-white md:flex print:hidden">
      <div className="flex items-center gap-2 px-5 py-4">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">
          AI
        </span>
        <span className="text-sm font-semibold text-slate-900">経理オートメーション</span>
      </div>
      <div className="px-2 pb-2">
        <CompanySwitcher companies={companies} current={companyId} />
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-2">
        {sectionsFor(role, operator).map((section, i) => (
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

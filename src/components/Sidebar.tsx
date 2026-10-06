"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  SparkleIcon,
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

type NavItem = {
  href: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
};
type NavSection = { title?: string; items: NavItem[] };

export const NAV_SECTIONS: NavSection[] = [
  {
    items: [
      { href: "/", label: "ダッシュボード", icon: DashboardIcon },
      { href: "/briefing", label: "AIの朝のまとめ", icon: SparkleIcon },
      { href: "/ai-watch", label: "AIの見張り", icon: SparkleIcon },
      { href: "/assistant", label: "AIアシスタント", icon: SparkleIcon },
      { href: "/inbox", label: "AI受付箱", icon: SparkleIcon },
      {
        href: "/reports/monthly",
        label: "AIの月次レポート",
        icon: SparkleIcon,
      },
      { href: "/anomalies", label: "いつもと違う動き", icon: SparkleIcon },
      { href: "/ai-learning", label: "AIが覚えたこと", icon: SparkleIcon },
      { href: "/book-check", label: "帳簿の健康診断", icon: SparkleIcon },
      { href: "/account-review", label: "科目の見直し", icon: SparkleIcon },
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
      { href: "/quotes/ai", label: "AI見積アシスト", icon: SparkleIcon },
      { href: "/invoices", label: "請求書", icon: DocumentIcon },
      { href: "/billing-gaps", label: "請求漏れのチェック", icon: SparkleIcon },
      { href: "/purchase-orders", label: "発注書", icon: CartIcon },
      {
        href: "/po-matching",
        label: "発注書と請求書の突き合わせ",
        icon: CartIcon,
      },
      { href: "/contracts", label: "契約書の台帳", icon: NotebookIcon },
      { href: "/receivables", label: "売掛金・買掛金", icon: CoinsIcon },
      { href: "/collections", label: "督促・回収", icon: MailIcon },
      { href: "/customer-insights", label: "顧客の見守り", icon: SparkleIcon },
      { href: "/vendor-insights", label: "仕入先の見守り", icon: SparkleIcon },
      { href: "/foreign", label: "外貨建ての取引", icon: CoinsIcon },
      { href: "/credit", label: "与信管理", icon: ShieldIcon },
      { href: "/vendors", label: "取引先・顧客", icon: UsersIcon },
      { href: "/party-duplicates", label: "取引先の重複", icon: SparkleIcon },
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
      {
        href: "/quick-expense",
        label: "ひとことで経費入力",
        icon: SparkleIcon,
      },
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
      { href: "/receipt-forecast", label: "入金予測", icon: SparkleIcon },
      { href: "/payment-plan", label: "支払計画", icon: SparkleIcon },
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
      {
        href: "/payroll/standard",
        label: "算定基礎(標準報酬)",
        icon: ShieldIcon,
      },
      { href: "/year-end", label: "年末調整・源泉徴収票", icon: FileIcon },
      {
        href: "/staff-records",
        label: "労働者名簿・賃金台帳",
        icon: ClipboardIcon,
      },
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
      {
        href: "/cash-flow-statement",
        label: "キャッシュ・フロー計算書",
        icon: TrendIcon,
      },
      { href: "/financial-statements", label: "決算報告書", icon: FileIcon },
      { href: "/tax", label: "消費税集計", icon: PercentIcon },
      { href: "/tax/close", label: "消費税の決算整理", icon: PercentIcon },
      { href: "/corporate-tax", label: "法人税等の計算", icon: PercentIcon },
      { href: "/year-end-close", label: "決算の準備", icon: SparkleIcon },
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
      {
        href: "/quick-expense",
        label: "ひとことで経費入力",
        icon: SparkleIcon,
      },
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
              {
                href: "/opening-balances",
                label: "開始残高(乗り換え)",
                icon: ScaleIcon,
              },
              {
                href: "/monthly-close",
                label: "月次決算チェック",
                icon: ChecklistIcon,
              },
              { href: "/closing", label: "締め処理", icon: LockIcon },
              {
                href: "/accountant-export",
                label: "税理士向けデータ",
                icon: FileIcon,
              },
              {
                href: "/backup",
                label: "データのバックアップ",
                icon: DownloadIcon,
              },
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
    ...(operator
      ? [
          {
            title: "運営者",
            items: [
              { href: "/operator", label: "運営者メニュー", icon: GaugeIcon },
            ],
          },
        ]
      : []),
  ];
}

function NavLink({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  const ai = item.icon === SparkleIcon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={`group relative flex items-center gap-2.5 rounded-lg px-3 py-[7px] text-[13.5px] font-medium ${
        active
          ? "bg-white text-indigo-700 shadow-sm ring-1 ring-slate-200/80"
          : "text-slate-600 hover:bg-white/70 hover:text-slate-900"
      }`}
    >
      {active && (
        <span
          className="absolute top-1/2 left-0 h-4 w-[3px] -translate-y-1/2 rounded-full bg-indigo-600"
          aria-hidden
        />
      )}
      <Icon
        className={`h-[18px] w-[18px] shrink-0 ${active ? "text-indigo-600" : ai ? "text-indigo-400 group-hover:text-indigo-500" : "text-slate-400 group-hover:text-slate-500"}`}
      />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

// メニューの言葉で絞り込む(ひらがな・カタカナ・全角半角の違いは気にしない)
const fold = (s: string) =>
  s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u30a1-\u30f6]/g, (c) =>
      String.fromCharCode(c.charCodeAt(0) - 0x60),
    );

function NavList({
  sections,
  pathname,
  query,
  onNavigate,
}: {
  sections: NavSection[];
  pathname: string;
  query: string;
  onNavigate?: () => void;
}) {
  const q = fold(query.trim());
  const filtered = q
    ? sections
        .map((s) => ({
          ...s,
          items: s.items.filter(
            (i) => fold(i.label).includes(q) || fold(s.title ?? "").includes(q),
          ),
        }))
        .filter((s) => s.items.length)
    : sections;
  if (!filtered.length)
    return (
      <p className="px-3 py-6 text-center text-xs text-slate-400">
        「{query}」に合うメニューはありません
      </p>
    );
  return (
    <>
      {filtered.map((section, i) => (
        <div key={section.title ?? i}>
          {section.title && (
            <div className="px-3 pb-1 text-[11px] font-semibold tracking-wider text-slate-400">
              {section.title}
            </div>
          )}
          <div className="space-y-px">
            {section.items.map((item) => (
              <NavLink
                key={item.href}
                item={item}
                active={pathname === item.href}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

function MenuSearch({
  value,
  onChange,
  inputRef,
  hint,
}: {
  value: string;
  onChange: (v: string) => void;
  inputRef?: React.Ref<HTMLInputElement>;
  hint?: boolean;
}) {
  return (
    <label className="relative block">
      <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onChange("")}
        placeholder="メニューを探す"
        aria-label="メニューを探す"
        className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pr-10 pl-8 text-sm placeholder:text-slate-400"
      />
      {hint && !value && (
        <kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border border-slate-200 bg-slate-50 px-1.5 text-[10px] font-medium text-slate-400">
          /
        </kbd>
      )}
    </label>
  );
}

function Brand() {
  return (
    <span className="flex items-center gap-2.5">
      <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-linear-to-br from-indigo-500 to-violet-600 text-[13px] font-bold text-white shadow-sm shadow-indigo-500/30">
        AI
      </span>
      <span className="leading-tight">
        <span className="block text-[13.5px] font-bold tracking-wide text-slate-900">
          経理オートメーション
        </span>
        <span className="block text-[10.5px] font-medium text-slate-400">
          AI-first back office
        </span>
      </span>
    </span>
  );
}

export function Sidebar({
  userName,
  role,
  companies,
  companyId,
  operator = false,
}: {
  userName: string;
  role: Role;
  companies: { id: string; name: string }[];
  companyId: string;
  operator?: boolean;
}) {
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const search = useRef<HTMLInputElement>(null);
  // 「/」か Ctrl/⌘+K でメニューを探す
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing =
        e.target instanceof HTMLElement &&
        (e.target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName));
      if (
        (e.key === "/" && !typing) ||
        (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey))
      ) {
        e.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-slate-200/80 bg-slate-50/80 backdrop-blur md:flex print:hidden">
      <div className="px-4 pt-4 pb-3">
        <Brand />
      </div>
      <div className="space-y-2 px-3 pb-3">
        <CompanySwitcher companies={companies} current={companyId} />
        <MenuSearch value={query} onChange={setQuery} inputRef={search} hint />
      </div>

      <nav
        className="flex-1 space-y-4 overflow-y-auto px-2 pt-1 pb-4"
        aria-label="メニュー"
      >
        <NavList
          sections={sectionsFor(role, operator)}
          pathname={pathname}
          query={query}
          onNavigate={() => setQuery("")}
        />
      </nav>

      <div className="flex items-center gap-2.5 border-t border-slate-200/80 px-4 py-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700">
          {userName.slice(0, 1)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium text-slate-700">
            {userName}
          </div>
          <LogoutButton />
        </div>
      </div>
    </aside>
  );
}

// スマホ: 上のバーの「メニュー」ボタンで、探せるメニューを横から開く
export function MobileNav({ role }: { role: Role }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const close = () => {
    setOpen(false);
    setQuery("");
  };
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const current = sectionsFor(role)
    .flatMap((s) => s.items)
    .find((i) => i.href === pathname);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-xs"
        aria-expanded={open}
        aria-label="メニューを開く"
      >
        <span className="flex flex-col gap-[3px]" aria-hidden>
          <span className="h-[1.5px] w-4 rounded bg-slate-600" />
          <span className="h-[1.5px] w-4 rounded bg-slate-600" />
          <span className="h-[1.5px] w-4 rounded bg-slate-600" />
        </span>
        <span className="max-w-[9rem] truncate">
          {current?.label ?? "メニュー"}
        </span>
      </button>
      {open &&
        // 上のバー(ぼかし効果つき)の中に置くと画面いっぱいに広がらないので、body の直下に出す
        createPortal(
          <div
            className="fixed inset-0 z-50 md:hidden"
            role="dialog"
            aria-modal="true"
            aria-label="メニュー"
          >
            <button
              className="absolute inset-0 bg-slate-900/30 backdrop-blur-[2px]"
              onClick={close}
              aria-label="メニューを閉じる"
            />
            <div
              className="absolute inset-y-0 left-0 flex w-[86%] max-w-xs flex-col bg-slate-50 shadow-lg"
              style={{ paddingTop: "env(safe-area-inset-top)" }}
            >
              <div className="flex items-center justify-between px-4 pt-4 pb-3">
                <Brand />
                <button
                  onClick={close}
                  className="rounded-lg p-2 text-slate-500 hover:bg-slate-200/60"
                  aria-label="閉じる"
                >
                  ✕
                </button>
              </div>
              <div className="px-3 pb-3">
                <MenuSearch value={query} onChange={setQuery} />
              </div>
              <nav className="flex-1 space-y-4 overflow-y-auto px-2 pb-4">
                <NavList
                  sections={sectionsFor(role)}
                  pathname={pathname}
                  query={query}
                  onNavigate={close}
                />
              </nav>
              <div
                className="border-t border-slate-200/80 px-4 py-3"
                style={{
                  paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))",
                }}
              >
                <LogoutButton />
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

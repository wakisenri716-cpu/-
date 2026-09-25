import { prisma } from "@/lib/prisma";
import { jstDateKey } from "@/lib/jst";
import { fiscalYearOf, getFiscalStartMonth } from "@/lib/accounting/period";
import { requireCompanyId } from "@/lib/auth/session";
import { getReimbursements } from "@/lib/accounting/reimbursement";
import { countDueRecurring } from "@/lib/accounting/recurring";
import { countDueRecurringInvoices } from "@/lib/accounting/recurringInvoices";

export async function getDashboardSummary() {
  const companyId = await requireCompanyId();

  const [autoPosted, pendingJournals, postedManually, recentEntries, pendingBank] = await Promise.all([
    // 自動化率はAIが判定した仕訳(経費・請求書・銀行明細)だけで測る。POS・在庫・手入力などは対象外。
    prisma.journalEntry.count({ where: { companyId, createdByAi: true, status: "AUTO_POSTED" } }),
    prisma.journalEntry.count({ where: { companyId, createdByAi: true, status: "PENDING_REVIEW" } }),
    prisma.journalEntry.count({ where: { companyId, createdByAi: true, status: "POSTED_MANUALLY" } }),
    prisma.journalEntry.findMany({
      where: { companyId, status: { not: "VOID" } },
      include: { lines: { include: { account: true } } },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    // 銀行明細の確認待ちは仕訳になる前の段階なので、仕訳とは別に数えてレビュー待ちに含める
    prisma.bankTransaction.count({ where: { companyId, status: "PENDING" } }),
  ]);
  const pendingReview = pendingJournals + pendingBank;

  const totalHandled = autoPosted + pendingReview + postedManually;
  const automationRate = totalHandled === 0 ? 0 : autoPosted / totalHandled;

  return { autoPosted, pendingReview, postedManually, automationRate, recentEntries };
}

const POSTED = ["AUTO_POSTED", "POSTED_MANUALLY"] as const;
const SETTLEABLE = ["CONFIRMED", "SENT", "PARTIALLY_PAID", "OVERDUE"] as const;

function monthKey(date: Date) {
  return date.toISOString().slice(0, 7);
}

function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
}

// 直近12か月の売上・費用・利益。売上は収益科目の貸方−借方、費用は費用科目の借方−貸方。
export async function getMonthlyTrend(companyId: string, today = jstDateKey(new Date())) {
  const current = today.slice(0, 7);
  const months = Array.from({ length: 12 }, (_, i) => shiftMonth(current, i - 11));
  const lines = await prisma.journalLine.findMany({
    where: {
      account: { category: { in: ["REVENUE", "EXPENSE"] } },
      journalEntry: {
        companyId,
        status: { in: [...POSTED] },
        date: { gte: new Date(`${months[0]}-01T00:00:00Z`), lt: new Date(`${shiftMonth(current, 1)}-01T00:00:00Z`) },
      },
    },
    select: { debit: true, credit: true, account: { select: { category: true } }, journalEntry: { select: { date: true } } },
  });
  const byMonth = new Map(months.map((m) => [m, { month: m, revenue: 0, expense: 0 }]));
  for (const line of lines) {
    const row = byMonth.get(monthKey(line.journalEntry.date));
    if (!row) continue;
    if (line.account.category === "REVENUE") row.revenue += line.credit - line.debit;
    else row.expense += line.debit - line.credit;
  }
  return [...byMonth.values()].map((r) => ({ ...r, profit: r.revenue - r.expense }));
}

export async function getCashBalance(companyId: string) {
  const sums = await prisma.journalLine.aggregate({
    where: { account: { companyId, code: { in: ["1010", "1020"] } }, journalEntry: { companyId, status: { in: [...POSTED] } } },
    _sum: { debit: true, credit: true },
  });
  return (sums._sum.debit ?? 0) - (sums._sum.credit ?? 0);
}

export type TodoItem = { key: string; label: string; detail: string; count: number; href: string; tone: "amber" | "rose" | "slate" };

// ダッシュボードの「やることリスト」。件数が0のものは出さない。
export async function getTodos(companyId: string, now = new Date()): Promise<TodoItem[]> {
  const today = jstDateKey(now);
  const lastMonth = shiftMonth(today.slice(0, 7), -1);
  const lastMonthRange = { gte: new Date(`${lastMonth}-01T00:00:00Z`), lt: new Date(`${today.slice(0, 7)}-01T00:00:00Z`) };
  const [reviews, bank, overdue, forgot, lastMonthShifts, lastMonthRecords, payroll, stockouts, reimbursements, recurringDue, recurringInvoicesDue] = await Promise.all([
    prisma.journalEntry.count({ where: { companyId, status: "PENDING_REVIEW" } }),
    prisma.bankTransaction.count({ where: { companyId, status: "PENDING" } }),
    prisma.invoice.count({ where: { companyId, status: { in: [...SETTLEABLE] }, dueDate: { lt: new Date(`${today}T00:00:00Z`) } } }),
    prisma.timeRecord.count({ where: { companyId, clockOut: null, clockIn: { lt: new Date(now.getTime() - 16 * 3_600_000) } } }),
    prisma.shift.count({ where: { companyId, date: lastMonthRange } }),
    prisma.timeRecord.count({ where: { companyId, date: lastMonthRange } }),
    prisma.payrollRun.findUnique({ where: { companyId_month: { companyId, month: lastMonth } } }),
    // 在庫切れ、または発注点以下になった商品
    prisma.product.count({
      where: {
        companyId,
        OR: [{ reorderPoint: null, quantityOnHand: { lte: 0 } }, { quantityOnHand: { lte: prisma.product.fields.reorderPoint } }],
      },
    }),
    getReimbursements(companyId),
    countDueRecurring(companyId),
    countDueRecurringInvoices(companyId),
  ]);
  const [ly, lm] = lastMonth.split("-").map(Number);
  const todos: TodoItem[] = [
    { key: "review", label: "AI仕訳のレビュー待ち", detail: "経費・請求書のAI判定を確認してください", count: reviews, href: "/review", tone: "amber" },
    { key: "bank", label: "銀行明細の確認待ち", detail: "勘定科目を選んで確定してください", count: bank, href: "/bank", tone: "amber" },
    { key: "overdue", label: "支払期限を過ぎた請求書", detail: "入金・支払の状況を確認してください", count: overdue, href: "/invoices", tone: "rose" },
    { key: "recurringInvoices", label: "定期請求の作成", detail: "請求日が来た毎月の請求書を作成してください", count: recurringInvoicesDue, href: "/recurring-invoices", tone: "amber" },
    { key: "recurring", label: "定期取引の記帳", detail: "記帳日が来た家賃などを記帳してください", count: recurringDue, href: "/recurring", tone: "amber" },
    {
      key: "approve",
      label: "承認待ちの経費精算",
      detail: "申請された経費精算を確認して、承認か差戻しをしてください",
      count: reimbursements.filter((r) => r.state === "AWAITING_APPROVAL" && r.approvalStatus === "SUBMITTED").length,
      href: "/reimbursements",
      tone: "amber",
    },
    {
      key: "reimburse",
      label: "立替経費の精算待ち",
      detail: "従業員が立て替えた経費を支払って「精算する」を押してください",
      count: reimbursements.filter((r) => r.state === "READY").length,
      href: "/reimbursements",
      tone: "amber",
    },
    { key: "forgot", label: "退勤の打刻忘れ", detail: "勤怠一覧で退勤時刻を入れてください", count: forgot, href: "/attendance", tone: "rose" },
    {
      key: "payroll",
      label: `${ly}年${lm}月分の給料が未計上`,
      detail: "シフト管理から給料として計上してください",
      count: !payroll && lastMonthShifts + lastMonthRecords > 0 ? 1 : 0,
      href: "/shifts",
      tone: "amber",
    },
    { key: "stock", label: "発注が必要な商品", detail: "在庫切れ・発注点以下の商品があります", count: stockouts, href: "/inventory", tone: "slate" },
  ];
  return todos.filter((t) => t.count > 0);
}

export type RankItem = { label: string; amount: number; href?: string };

// 今期(期首から今日まで)の顧客別売上(発行請求書の税抜金額)と、費用の内訳(科目別)の上位5件
export async function getRankings(companyId: string, today = jstDateKey(new Date())) {
  const startMonth = await getFiscalStartMonth(companyId);
  const fy = fiscalYearOf(today, startMonth);
  const range = { gte: new Date(`${fy.from}T00:00:00Z`), lt: new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000) };
  const [invoices, expenseLines] = await Promise.all([
    prisma.invoice.groupBy({
      by: ["customerId"],
      where: { companyId, direction: "ISSUED", status: { in: [...SETTLEABLE, "PAID"] }, issueDate: range, customerId: { not: null } },
      _sum: { subtotalAmount: true },
    }),
    prisma.journalLine.groupBy({
      by: ["accountId"],
      where: { account: { companyId, category: "EXPENSE" }, journalEntry: { companyId, status: { in: [...POSTED] }, date: range } },
      _sum: { debit: true, credit: true },
    }),
  ]);
  const [customers, accounts] = await Promise.all([
    prisma.customer.findMany({ where: { id: { in: invoices.map((i) => i.customerId!) } }, select: { id: true, name: true } }),
    prisma.account.findMany({ where: { id: { in: expenseLines.map((l) => l.accountId) } }, select: { id: true, name: true } }),
  ]);
  const top = (items: RankItem[]) => {
    const sorted = items.filter((i) => i.amount > 0).sort((a, b) => b.amount - a.amount);
    const rest = sorted.slice(5).reduce((s, i) => s + i.amount, 0);
    return rest > 0 ? [...sorted.slice(0, 5), { label: "その他", amount: rest }] : sorted;
  };
  return {
    fiscalYear: fy.year,
    customers: top(
      invoices.map((i) => ({
        label: customers.find((c) => c.id === i.customerId)?.name ?? "-",
        amount: i._sum.subtotalAmount ?? 0,
        href: `/vendors/customer/${i.customerId}`,
      })),
    ),
    expenses: top(
      expenseLines.map((l) => ({
        label: accounts.find((a) => a.id === l.accountId)?.name ?? "-",
        amount: (l._sum.debit ?? 0) - (l._sum.credit ?? 0),
        href: `/ledger?accountId=${l.accountId}`,
      })),
    ),
  };
}

export type SetupStep = { key: string; label: string; detail: string; href: string; done: boolean };

// 管理者向け「はじめにやること」。それぞれ実際のデータから済んだかどうかを判定する。
export async function getSetupSteps(companyId: string, user: { id: string; totpEnabled: boolean }): Promise<SetupStep[]> {
  const [company, users, invoices, bank, expenses, backups] = await Promise.all([
    prisma.company.findUnique({ where: { id: companyId }, select: { address: true, registrationNumber: true, bankAccount: true } }),
    prisma.user.count({ where: { companyId, passwordHash: { not: null } } }),
    prisma.invoice.count({ where: { companyId } }),
    prisma.bankTransaction.count({ where: { companyId } }),
    prisma.expenseItem.count({ where: { expenseReport: { companyId } } }),
    prisma.auditLog.count({ where: { companyId, action: "データをバックアップ" } }),
  ]);
  return [
    { key: "company", label: "会社情報を登録する", detail: "住所・振込先・インボイスの登録番号(請求書に印字されます)", href: "/company", done: !!(company?.address || company?.registrationNumber || company?.bankAccount) },
    { key: "totp", label: "2段階認証を設定する", detail: "パスワードが漏れても、スマホがなければログインできなくなります", href: "/account", done: user.totpEnabled },
    { key: "users", label: "メンバーを招待する", detail: "経理担当・従業員のアカウントを作ります", href: "/users", done: users > 1 },
    { key: "expense", label: "レシートを登録してみる", detail: "経費精算で写真をアップロードすると、AIが仕訳します", href: "/expenses", done: expenses > 0 },
    { key: "invoice", label: "請求書を作る・取り込む", detail: "作成すると売上の仕訳も自動で記帳されます", href: "/invoices", done: invoices > 0 },
    { key: "bank", label: "銀行明細を取り込む", detail: "ネットバンキングのCSVから入出金をまとめて記帳します", href: "/bank", done: bank > 0 },
    { key: "backup", label: "データをバックアップする", detail: "全データをZIPで手元に保存します(月1回がおすすめ)", href: "/backup", done: backups > 0 },
  ];
}

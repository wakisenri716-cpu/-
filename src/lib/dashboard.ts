import { prisma } from "@/lib/prisma";
import { jstDateKey } from "@/lib/jst";
import { requireCompanyId } from "@/lib/auth/session";
import { getReimbursements } from "@/lib/accounting/reimbursement";
import { countDueRecurring } from "@/lib/accounting/recurring";

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
  const [reviews, bank, overdue, forgot, lastMonthShifts, lastMonthRecords, payroll, stockouts, reimbursements, recurringDue] = await Promise.all([
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
  ]);
  const [ly, lm] = lastMonth.split("-").map(Number);
  const todos: TodoItem[] = [
    { key: "review", label: "AI仕訳のレビュー待ち", detail: "経費・請求書のAI判定を確認してください", count: reviews, href: "/review", tone: "amber" },
    { key: "bank", label: "銀行明細の確認待ち", detail: "勘定科目を選んで確定してください", count: bank, href: "/bank", tone: "amber" },
    { key: "overdue", label: "支払期限を過ぎた請求書", detail: "入金・支払の状況を確認してください", count: overdue, href: "/invoices", tone: "rose" },
    { key: "recurring", label: "定期取引の記帳", detail: "記帳日が来た家賃などを記帳してください", count: recurringDue, href: "/recurring", tone: "amber" },
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

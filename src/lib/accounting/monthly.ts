import { prisma } from "@/lib/prisma";
import { jstDateKey } from "@/lib/jst";
import { fiscalYearOf, getFiscalStartMonth } from "./period";
import { UserError } from "@/lib/errors";

const POSTED_STATUSES = ["AUTO_POSTED", "POSTED_MANUALLY"] as const;

export class BudgetError extends UserError {}

function monthKey(date: Date) {
  return date.toISOString().slice(0, 7);
}

function addMonths(month: string, n: number) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

// fiscalYear を省略したら今期。fiscalYear は期首の年(4月始まりなら 2026年4月〜2027年3月 が 2026年度)
export async function resolveFiscalYear(companyId: string, requested?: string | null) {
  const startMonth = await getFiscalStartMonth(companyId);
  const current = fiscalYearOf(jstDateKey(new Date()), startMonth).year;
  const year = requested && /^\d{4}$/.test(requested) ? Number(requested) : current;
  const first = `${year}-${String(startMonth).padStart(2, "0")}`;
  const months = Array.from({ length: 12 }, (_, i) => addMonths(first, i));
  return { year, current, startMonth, months };
}

type Row = { accountId: string; code: string; name: string; months: number[]; total: number; budget: number | null };

// 月次推移表: 収益・費用の科目ごとに、期首から12か月の金額と年間予算を並べる
export async function getMonthlyTable(companyId: string, fiscalYear?: string | null) {
  const fy = await resolveFiscalYear(companyId, fiscalYear);
  const [accounts, lines, budgets] = await Promise.all([
    prisma.account.findMany({ where: { companyId, category: { in: ["REVENUE", "EXPENSE"] } }, orderBy: { code: "asc" } }),
    prisma.journalLine.findMany({
      where: {
        account: { companyId, category: { in: ["REVENUE", "EXPENSE"] } },
        journalEntry: {
          companyId,
          status: { in: [...POSTED_STATUSES] },
          date: { gte: new Date(`${fy.months[0]}-01T00:00:00Z`), lt: new Date(`${addMonths(fy.months[11], 1)}-01T00:00:00Z`) },
        },
      },
      select: { accountId: true, debit: true, credit: true, journalEntry: { select: { date: true } } },
    }),
    prisma.budget.findMany({ where: { companyId, fiscalYear: fy.year } }),
  ]);

  const budgetOf = new Map(budgets.map((b) => [b.accountId, b.amount]));
  const amounts = new Map<string, number[]>();
  for (const line of lines) {
    const i = fy.months.indexOf(monthKey(line.journalEntry.date));
    if (i < 0) continue;
    const row = amounts.get(line.accountId) ?? Array(12).fill(0);
    row[i] += line.credit - line.debit; // いったん貸方プラスで集計し、費用は下で符号を反転する
    amounts.set(line.accountId, row);
  }

  const build = (category: "REVENUE" | "EXPENSE"): Row[] =>
    accounts
      .filter((a) => a.category === category && (amounts.has(a.id) || budgetOf.has(a.id)))
      .map((a) => {
        const raw = amounts.get(a.id) ?? Array(12).fill(0);
        const months = category === "REVENUE" ? raw : raw.map((v) => -v);
        return { accountId: a.id, code: a.code, name: a.name, months, total: months.reduce((s, v) => s + v, 0), budget: budgetOf.get(a.id) ?? null };
      });

  const sum = (rows: Row[]) => {
    const months = Array.from({ length: 12 }, (_, i) => rows.reduce((s, r) => s + r.months[i], 0));
    const withBudget = rows.filter((r) => r.budget !== null);
    return { months, total: months.reduce((s, v) => s + v, 0), budget: withBudget.length ? withBudget.reduce((s, r) => s + r.budget!, 0) : null };
  };

  const revenue = build("REVENUE");
  const expense = build("EXPENSE");
  const revenueTotal = sum(revenue);
  const expenseTotal = sum(expense);
  const profitMonths = revenueTotal.months.map((v, i) => v - expenseTotal.months[i]);
  const profit = {
    months: profitMonths,
    total: revenueTotal.total - expenseTotal.total,
    // 片方だけ予算があると利益の予算として意味をなさないので、両方あるときだけ出す
    budget: revenueTotal.budget !== null && expenseTotal.budget !== null ? revenueTotal.budget - expenseTotal.budget : null,
  };
  return { ...fy, revenue, expense, revenueTotal, expenseTotal, profit };
}

// 予算の入力画面用: 収益・費用の全科目と、その年度の予算
export async function getBudgets(companyId: string, fiscalYear?: string | null) {
  const fy = await resolveFiscalYear(companyId, fiscalYear);
  const [accounts, budgets] = await Promise.all([
    prisma.account.findMany({ where: { companyId, category: { in: ["REVENUE", "EXPENSE"] } }, orderBy: { code: "asc" } }),
    prisma.budget.findMany({ where: { companyId, fiscalYear: fy.year } }),
  ]);
  const budgetOf = new Map(budgets.map((b) => [b.accountId, b.amount]));
  return {
    year: fy.year,
    accounts: accounts.map((a) => ({ id: a.id, code: a.code, name: a.name, category: a.category, budget: budgetOf.get(a.id) ?? null })),
  };
}

// 空欄(null)の科目は予算を消す
export async function saveBudgets(companyId: string, fiscalYear: number, entries: { accountId: string; amount: number | null }[]) {
  if (!Number.isInteger(fiscalYear) || fiscalYear < 2000 || fiscalYear > 2100) throw new BudgetError("年度が正しくありません");
  const accounts = await prisma.account.findMany({
    where: { companyId, id: { in: entries.map((e) => e.accountId) }, category: { in: ["REVENUE", "EXPENSE"] } },
    select: { id: true },
  });
  const valid = new Set(accounts.map((a) => a.id));
  for (const e of entries) {
    if (!valid.has(e.accountId)) throw new BudgetError("勘定科目が見つかりません");
    if (e.amount !== null && (!Number.isInteger(e.amount) || e.amount < 0 || e.amount > 100_000_000_000)) {
      throw new BudgetError("予算は0以上の整数(円)で入力してください");
    }
  }
  await prisma.$transaction(
    entries.map((e) =>
      e.amount === null
        ? prisma.budget.deleteMany({ where: { companyId, fiscalYear, accountId: e.accountId } })
        : prisma.budget.upsert({
            where: { companyId_fiscalYear_accountId: { companyId, fiscalYear, accountId: e.accountId } },
            update: { amount: e.amount },
            create: { companyId, fiscalYear, accountId: e.accountId, amount: e.amount },
          }),
    ),
  );
}

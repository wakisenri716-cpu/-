import type { LoanMethod } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { UserError, toBooksClosedError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { ensureAccount, ensureChartOfAccounts } from "@/lib/accounting/accounts";
import { cashAccountCodes } from "@/lib/bank/accounts";
import { buildSchedule, type LoanTerms } from "@/lib/accounting/loanSchedule";

// 借入金の管理: 借入の内容から返済予定表を作り、毎月の返済を「借入金・支払利息 / 預金」で記帳する

const LOAN_CODE = "2210";
const INTEREST_CODE = "5150";
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

type Input = {
  name?: unknown;
  principal?: unknown;
  annualRate?: unknown; // 画面からは「1.5」(%)で受け取る
  months?: unknown;
  method?: unknown;
  borrowedAt?: unknown;
  firstPaymentMonth?: unknown;
  paymentDay?: unknown;
  bankCode?: unknown;
  notes?: unknown;
  opening?: unknown; // true なら借入の仕訳も作る
};

const int = (v: unknown) => Number(String(v ?? "").replaceAll(",", "").trim());

async function bankAccounts(companyId: string) {
  const codes = await cashAccountCodes(companyId);
  return prisma.account.findMany({ where: { companyId, code: { in: codes } }, select: { code: true, name: true }, orderBy: { code: "asc" } });
}

async function parseTerms(companyId: string, input: Input) {
  const name = String(input.name ?? "").trim();
  if (!name) throw new UserError("借入の名前を入力してください(例: ○○銀行 運転資金)");
  if (name.length > 60) throw new UserError("名前は60文字以内で入力してください");
  const principal = int(input.principal);
  if (!Number.isInteger(principal) || principal <= 0 || principal > 100_000_000_000) throw new UserError("借入額は1円以上の整数で入力してください");
  const ratePercent = Number(String(input.annualRate ?? "").trim() || "0");
  const annualRate = Math.round(ratePercent * 1000);
  if (!Number.isFinite(ratePercent) || annualRate < 0 || annualRate > 20_000) throw new UserError("年利は0〜20%で入力してください(例: 1.5)");
  const months = int(input.months);
  if (!Number.isInteger(months) || months < 1 || months > 600) throw new UserError("返済回数は1〜600回(月)で入力してください");
  const method = String(input.method ?? "EQUAL_PAYMENT") as LoanMethod;
  if (method !== "EQUAL_PAYMENT" && method !== "EQUAL_PRINCIPAL") throw new UserError("返済方法を選んでください");
  const borrowed = String(input.borrowedAt ?? "");
  if (!DATE.test(borrowed) || Number.isNaN(Date.parse(`${borrowed}T00:00:00Z`))) throw new UserError("借りた日を正しく入力してください");
  const firstPaymentMonth = String(input.firstPaymentMonth ?? "");
  if (!MONTH.test(firstPaymentMonth)) throw new UserError("最初の返済月を選んでください");
  if (firstPaymentMonth < borrowed.slice(0, 7)) throw new UserError("最初の返済月は借りた月以降にしてください");
  const paymentDay = int(input.paymentDay || 31);
  if (!Number.isInteger(paymentDay) || paymentDay < 1 || paymentDay > 31) throw new UserError("返済日は1〜31日で入力してください(31は月末)");
  const bankCode = String(input.bankCode ?? "1020");
  if (!(await bankAccounts(companyId)).some((a) => a.code === bankCode)) throw new UserError("返済に使う口座を選んでください");
  const notes = String(input.notes ?? "").trim();
  if (notes.length > 300) throw new UserError("メモは300文字以内で入力してください");
  return { name, principal, annualRate, months, method, borrowedAt: new Date(`${borrowed}T00:00:00Z`), firstPaymentMonth, paymentDay, bankCode, notes: notes || null };
}

const termsOf = (l: { principal: number; annualRate: number; months: number; method: LoanMethod; firstPaymentMonth: string; paymentDay: number }): LoanTerms => ({
  principal: l.principal,
  annualRate: l.annualRate,
  months: l.months,
  method: l.method,
  firstPaymentMonth: l.firstPaymentMonth,
  paymentDay: l.paymentDay,
});

export async function createLoan(companyId: string, input: Input) {
  const data = await parseTerms(companyId, input);
  try {
    return await prisma.$transaction(async (tx) => {
      let openingEntryId: string | null = null;
      if (input.opening === true) {
        const bank = await ensureAccount(tx, companyId, data.bankCode);
        const loan = await ensureAccount(tx, companyId, LOAN_CODE);
        const entry = await tx.journalEntry.create({
          data: {
            companyId,
            date: data.borrowedAt,
            description: `${data.name} 借入`,
            sourceType: "LOAN",
            status: "POSTED_MANUALLY",
            lines: {
              create: [
                { accountId: bank.id, debit: data.principal, credit: 0, memo: data.name },
                { accountId: loan.id, debit: 0, credit: data.principal, memo: data.name },
              ],
            },
          },
        });
        openingEntryId = entry.id;
      }
      return tx.loan.create({ data: { companyId, ...data, openingEntryId } });
    });
  } catch (error) {
    throw toBooksClosedError(error) ?? error;
  }
}

// 返済を記帳し始めたら、借入額・年利・回数・方法・最初の返済月は変えられない
export async function updateLoan(companyId: string, id: string, input: Input & { active?: unknown }) {
  const current = await prisma.loan.findFirst({ where: { id, companyId }, include: { _count: { select: { payments: true } } } });
  if (!current) throw new UserError("借入が見つかりません");
  if (typeof input.active === "boolean" && Object.keys(input).length === 1) return prisma.loan.update({ where: { id }, data: { active: input.active } });
  const locked = current._count.payments > 0;
  const data = await parseTerms(companyId, {
    ...input,
    ...(locked
      ? { principal: current.principal, annualRate: current.annualRate / 1000, months: current.months, method: current.method, firstPaymentMonth: current.firstPaymentMonth, borrowedAt: jstDateKey(current.borrowedAt) }
      : {}),
  });
  if (current.openingEntryId && (data.principal !== current.principal || data.borrowedAt.getTime() !== current.borrowedAt.getTime() || data.bankCode !== current.bankCode)) {
    throw new UserError("借入の仕訳を作った借入は、借入額・借りた日・口座を変えられません。削除して登録し直してください");
  }
  return prisma.loan.update({ where: { id }, data });
}

export async function deleteLoan(companyId: string, id: string) {
  const current = await prisma.loan.findFirst({ where: { id, companyId }, include: { _count: { select: { payments: true } } } });
  if (!current) throw new UserError("借入が見つかりません");
  if (current._count.payments) throw new UserError("返済を記帳した借入は削除できません。先に返済の記帳を取り消してください");
  try {
    await prisma.$transaction(async (tx) => {
      if (current.openingEntryId) await tx.journalEntry.update({ where: { id: current.openingEntryId }, data: { status: "VOID" } });
      await tx.loan.delete({ where: { id } });
    });
  } catch (error) {
    throw toBooksClosedError(error) ?? error;
  }
  return current;
}

async function loadLoans(companyId: string) {
  return prisma.loan.findMany({
    where: { companyId },
    include: { payments: { orderBy: { month: "asc" } }, openingEntry: { select: { status: true } } },
    orderBy: [{ active: "desc" }, { createdAt: "asc" }],
  });
}

function shape(l: Awaited<ReturnType<typeof loadLoans>>[number], today: string) {
  const schedule = buildSchedule(termsOf(l), l.payments);
  const paidPrincipal = l.payments.reduce((s, p) => s + p.principal, 0);
  const paidInterest = l.payments.reduce((s, p) => s + p.interest, 0);
  const unposted = schedule.filter((r) => !r.posted);
  return {
    id: l.id,
    name: l.name,
    principal: l.principal,
    annualRate: l.annualRate,
    months: l.months,
    method: l.method,
    borrowedAt: jstDateKey(l.borrowedAt),
    firstPaymentMonth: l.firstPaymentMonth,
    paymentDay: l.paymentDay,
    bankCode: l.bankCode,
    notes: l.notes,
    active: l.active,
    opening: !!l.openingEntry && l.openingEntry.status !== "VOID",
    schedule,
    paidCount: l.payments.length,
    paidPrincipal,
    paidInterest,
    remaining: l.principal - paidPrincipal,
    // 予定表どおりに返したときに、これから払う利息
    futureInterest: unposted.reduce((s, r) => s + r.interest, 0),
    next: unposted[0] ?? null,
    due: l.active ? unposted.filter((r) => r.date <= today).map((r) => r.month) : [],
    lastPaid: l.payments.at(-1)?.month ?? null,
    done: l.payments.length === l.months,
  };
}

export async function listLoans(companyId: string, now = new Date()) {
  const today = jstDateKey(now);
  await ensureChartOfAccounts(companyId);
  const [loans, banks, book] = await Promise.all([
    loadLoans(companyId),
    bankAccounts(companyId),
    prisma.journalLine.aggregate({
      where: { account: { companyId, code: LOAN_CODE }, journalEntry: { companyId, status: { in: ["AUTO_POSTED", "POSTED_MANUALLY"] } } },
      _sum: { debit: true, credit: true },
    }),
  ]);
  const rows = loans.map((l) => shape(l, today));
  const thisMonth = today.slice(0, 7);
  const in12 = rows.flatMap((r) => (r.active ? r.schedule.filter((s) => !s.posted && s.month >= thisMonth && s.month < addMonth(thisMonth, 12)) : []));
  return {
    today,
    rows,
    banks,
    summary: {
      remaining: rows.reduce((s, r) => s + r.remaining, 0),
      // 帳簿の借入金(2210)の残高。登録した借入の残高と合っているかの確認用
      bookBalance: (book._sum.credit ?? 0) - (book._sum.debit ?? 0),
      thisMonth: rows.reduce((s, r) => s + (r.active ? (r.schedule.find((x) => x.month === thisMonth)?.total ?? 0) : 0), 0),
      next12: in12.reduce((s, r) => s + r.total, 0),
      next12Interest: in12.reduce((s, r) => s + r.interest, 0),
      due: rows.reduce((s, r) => s + r.due.length, 0),
    },
  };
}

function addMonth(month: string, n: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// 1回分の返済を記帳する。銀行の返済予定表と額が違うときは、元金・利息を指定できる
export async function postPayment(companyId: string, id: string, input: { month?: unknown; principal?: unknown; interest?: unknown }, now = new Date()) {
  const today = jstDateKey(now);
  const l = (await loadLoans(companyId)).find((x) => x.id === id);
  if (!l) throw new UserError("借入が見つかりません");
  if (!l.active) throw new UserError("止めている借入は記帳できません");
  const row = shape(l, today);
  const month = String(input.month ?? "");
  const plan = row.schedule.find((s) => s.month === month);
  if (!plan) throw new UserError(`${month} は返済の期間外です`);
  if (plan.posted) throw new UserError(`${month} 分はすでに記帳しています`);
  if (row.next && row.next.month !== month) throw new UserError(`先に ${row.next.month} 分を記帳してください`);
  if (plan.date > today) throw new UserError("返済日が来ていない回は記帳できません");
  const last = plan.no === l.months;
  const principal = input.principal === undefined || input.principal === "" ? plan.principal : int(input.principal);
  const interest = input.interest === undefined || input.interest === "" ? plan.interest : int(input.interest);
  if (!Number.isInteger(principal) || principal < 0 || !Number.isInteger(interest) || interest < 0) throw new UserError("元金・利息は0以上の整数で入力してください");
  if (principal + interest <= 0) throw new UserError("返済額が0円です");
  if (principal > row.remaining) throw new UserError(`元金が借入の残高(${row.remaining.toLocaleString("ja-JP")}円)を超えています`);
  if (last && principal !== row.remaining) throw new UserError(`最後の回は、残りの元金(${row.remaining.toLocaleString("ja-JP")}円)をすべて返済してください`);
  try {
    return await prisma.$transaction(async (tx) => {
      const bank = await ensureAccount(tx, companyId, l.bankCode);
      const lines = [];
      if (principal) lines.push({ accountId: (await ensureAccount(tx, companyId, LOAN_CODE)).id, debit: principal, credit: 0, memo: l.name });
      if (interest) lines.push({ accountId: (await ensureAccount(tx, companyId, INTEREST_CODE)).id, debit: interest, credit: 0, memo: l.name });
      lines.push({ accountId: bank.id, debit: 0, credit: principal + interest, memo: l.name });
      const [, m] = month.split("-").map(Number);
      const entry = await tx.journalEntry.create({
        data: {
          companyId,
          date: new Date(`${plan.date}T00:00:00Z`),
          description: `${l.name} ${m}月返済(${plan.no}/${l.months})`,
          sourceType: "LOAN",
          status: "POSTED_MANUALLY",
          lines: { create: lines },
        },
      });
      await tx.loanPayment.create({ data: { loanId: l.id, month, principal, interest, journalEntryId: entry.id } });
      return { loan: l, month, principal, interest };
    });
  } catch (error) {
    const closed = toBooksClosedError(error);
    if (closed) throw closed;
    if ((error as { code?: string }).code === "P2002") throw new UserError(`${month} 分はすでに記帳しています`);
    throw error;
  }
}

// 最後に記帳した返済を取り消す(仕訳は取消)
export async function undoLastPayment(companyId: string, id: string) {
  const l = await prisma.loan.findFirst({ where: { id, companyId }, include: { payments: { orderBy: { month: "desc" }, take: 1 } } });
  if (!l) throw new UserError("借入が見つかりません");
  const last = l.payments[0];
  if (!last) throw new UserError("取り消す返済がありません");
  try {
    await prisma.$transaction(async (tx) => {
      await tx.loanPayment.delete({ where: { id: last.id } });
      await tx.journalEntry.update({ where: { id: last.journalEntryId }, data: { status: "VOID" } });
    });
  } catch (error) {
    throw toBooksClosedError(error) ?? error;
  }
  return { loan: l, month: last.month, principal: last.principal, interest: last.interest };
}

// 返済日が来ている未記帳の回を、予定表の額でまとめて記帳する
export async function postAllDue(companyId: string, now = new Date()) {
  const { rows } = await listLoans(companyId, now);
  let posted = 0;
  const errors: string[] = [];
  for (const r of rows) {
    for (const month of r.due) {
      try {
        await postPayment(companyId, r.id, { month }, now);
        posted++;
      } catch (error) {
        errors.push(`${r.name} ${month}: ${error instanceof Error ? error.message : "失敗しました"}`);
        break;
      }
    }
  }
  return { posted, errors };
}

export async function countDueLoanPayments(companyId: string, now = new Date()) {
  const today = jstDateKey(now);
  const loans = await prisma.loan.findMany({ where: { companyId, active: true, firstPaymentMonth: { lte: today.slice(0, 7) } }, include: { payments: true } });
  return loans.reduce((s, l) => s + buildSchedule(termsOf(l), l.payments).filter((r) => !r.posted && r.date <= today).length, 0);
}

// 資金繰り予測用: まだ記帳していない返済(返済日を過ぎたものは今月に入れる)
export async function loanOutflows(companyId: string, today: string, months: string[]) {
  const loans = await prisma.loan.findMany({ where: { companyId, active: true }, include: { payments: true } });
  const current = months[0];
  const items: { month: string; label: string; amount: number; note?: string }[] = [];
  for (const l of loans) {
    for (const r of buildSchedule(termsOf(l), l.payments)) {
      if (r.posted) continue;
      const overdue = r.date <= today;
      const month = overdue ? current : r.month;
      if (!months.includes(month)) continue;
      items.push({ month, label: `${l.name}(借入金の返済)`, amount: r.total, note: overdue ? "返済日が来ています" : undefined });
    }
  }
  return items;
}

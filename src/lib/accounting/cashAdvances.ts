import { prisma } from "@/lib/prisma";
import { UserError, toBooksClosedError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { ensureAccount } from "./accounts";
import { getReimbursements } from "./reimbursement";

// 仮払金: 出張・買い出しなどの前に、従業員へ先にお金を渡す。
// 渡したとき  : 仮払金 / 現金・普通預金
// 精算したとき: 経費精算(未払金)と相殺し、差額は返してもらう(現金・預金 / 仮払金)か、足りない分を払う(未払金 / 現金・預金)。
// 経費精算は「精算済み」になるので、立替経費の精算で二重に払うことはない。

const ADVANCE = "1210"; // 仮払金
const PAYABLE = "2020"; // 未払金(経費精算の従業員立替分)
export const PAY_FROM = { "1010": "現金", "1020": "普通預金" } as const;
type PayFrom = keyof typeof PAY_FROM;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(value: unknown, label: string) {
  const v = String(value ?? "");
  if (!DATE.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) throw new UserError(`${label}を正しく入力してください`);
  return v;
}

function parsePayFrom(value: unknown) {
  const v = String(value ?? "1010");
  if (!(v in PAY_FROM)) throw new UserError("お金の出どころ(現金・普通預金)を選んでください");
  return v as PayFrom;
}

async function withBooksClosed<T>(fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (error) {
    throw toBooksClosedError(error) ?? error;
  }
}

export async function listCashAdvances(companyId: string) {
  const [advances, members, reimbursements] = await Promise.all([
    prisma.cashAdvance.findMany({
      where: { companyId },
      include: { employee: { select: { id: true, name: true } }, expenseReport: { select: { id: true, createdAt: true } } },
      orderBy: [{ status: "asc" }, { paidDate: "desc" }],
    }),
    prisma.companyMember.findMany({ where: { companyId, active: true }, include: { user: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } }),
    getReimbursements(companyId),
  ]);
  const linked = new Set(advances.map((a) => a.expenseReportId).filter(Boolean));
  // 相殺に使える経費精算: まだ精算していない、金額の確定したもの(承認が要る会社では承認済み)
  const reports = reimbursements
    .filter((r) => r.state === "READY" && !linked.has(r.id))
    .map((r) => ({ id: r.id, employeeId: r.employee.id, amount: r.amount, createdAt: jstDateKey(r.createdAt), itemCount: r.itemCount }));
  const today = jstDateKey(new Date());
  return {
    employees: members.map((m) => m.user),
    reports,
    advances: advances.map((a) => ({
      id: a.id,
      employee: a.employee,
      purpose: a.purpose,
      amount: a.amount,
      paidDate: jstDateKey(a.paidDate),
      payFrom: PAY_FROM[a.payFrom as PayFrom] ?? a.payFrom,
      status: a.status,
      settledDate: a.settledDate ? jstDateKey(a.settledDate) : null,
      reportAmount: a.expenseReportId ? (reimbursements.find((r) => r.id === a.expenseReportId)?.amount ?? null) : a.status === "SETTLED" ? 0 : null,
      days: Math.round((Date.parse(`${today}T00:00:00Z`) - a.paidDate.getTime()) / 86_400_000),
    })),
    outstanding: advances.filter((a) => a.status === "OPEN").reduce((s, a) => s + a.amount, 0),
  };
}

export async function createCashAdvance(companyId: string, input: { employeeId?: unknown; purpose?: unknown; amount?: unknown; paidDate?: unknown; payFrom?: unknown }) {
  const member = await prisma.companyMember.findFirst({ where: { companyId, userId: String(input.employeeId ?? ""), active: true }, include: { user: { select: { name: true } } } });
  if (!member) throw new UserError("渡す人を選んでください");
  const purpose = String(input.purpose ?? "").trim();
  if (!purpose) throw new UserError("用途を入力してください(例: 大阪出張の交通費・宿泊費)");
  if (purpose.length > 100) throw new UserError("用途は100文字以内にしてください");
  const amount = Number(String(input.amount ?? "").replaceAll(",", ""));
  if (!Number.isInteger(amount) || amount <= 0 || amount > 10_000_000) throw new UserError("金額を正しく入力してください");
  const paidDate = parseDate(input.paidDate, "渡した日");
  const payFrom = parsePayFrom(input.payFrom);
  return withBooksClosed(() =>
    prisma.$transaction(async (tx) => {
      const [advance, cash] = await Promise.all([ensureAccount(tx, companyId, ADVANCE), ensureAccount(tx, companyId, payFrom)]);
      const entry = await tx.journalEntry.create({
        data: {
          companyId,
          date: new Date(`${paidDate}T00:00:00Z`),
          description: `仮払金: ${member.user.name}さん ${purpose}`,
          sourceType: "REIMBURSEMENT",
          status: "POSTED_MANUALLY",
          lines: {
            create: [
              { accountId: advance.id, debit: amount, credit: 0, memo: "仮払金" },
              { accountId: cash.id, debit: 0, credit: amount, memo: PAY_FROM[payFrom] },
            ],
          },
        },
      });
      return tx.cashAdvance.create({
        data: { companyId, employeeId: member.userId, purpose, amount, paidDate: new Date(`${paidDate}T00:00:00Z`), payFrom, issueEntryId: entry.id },
        include: { employee: { select: { name: true } } },
      });
    }),
  );
}

// 精算: 経費精算(reportId)と相殺する。reportId がなければ、使わなかったので全額返してもらう
export async function settleCashAdvance(companyId: string, id: string, input: { reportId?: unknown; date?: unknown; payFrom?: unknown }) {
  const advance = await prisma.cashAdvance.findFirst({ where: { id, companyId }, include: { employee: { select: { name: true } } } });
  if (!advance) throw new UserError("仮払金が見つかりません");
  if (advance.status !== "OPEN") throw new UserError("この仮払金はすでに精算したか、取り消しています");
  const date = parseDate(input.date, "精算した日");
  if (date < jstDateKey(advance.paidDate)) throw new UserError("精算した日は、渡した日より後にしてください");
  const payFrom = parsePayFrom(input.payFrom);
  const reportId = input.reportId ? String(input.reportId) : null;
  let reportAmount = 0;
  if (reportId) {
    const report = (await getReimbursements(companyId)).find((r) => r.id === reportId);
    if (!report || report.employee.id !== advance.employeeId) throw new UserError("この人の経費精算を選んでください");
    if (report.state !== "READY") throw new UserError("精算できる状態の経費精算ではありません(レビュー待ち・未承認・精算済みのものは選べません)");
    reportAmount = report.amount;
  }
  const diff = advance.amount - reportAmount; // プラスなら返してもらう、マイナスなら払う

  return withBooksClosed(() =>
    prisma.$transaction(async (tx) => {
      // 2回押されても二重に仕訳ができないよう、先に状態を確保する
      const claimed = await tx.cashAdvance.updateMany({ where: { id, companyId, status: "OPEN" }, data: { status: "SETTLED", settledDate: new Date(`${date}T00:00:00Z`), expenseReportId: reportId } });
      if (claimed.count !== 1) throw new UserError("状態が変わりました。画面を更新してもう一度お試しください");
      if (reportId) {
        const reportClaimed = await tx.expenseReport.updateMany({ where: { id: reportId, companyId, reimbursedAt: null }, data: { reimbursedAt: new Date() } });
        if (reportClaimed.count !== 1) throw new UserError("この経費精算はすでに精算済みです");
      }
      const [advanceAccount, payable, cash] = await Promise.all([ensureAccount(tx, companyId, ADVANCE), ensureAccount(tx, companyId, PAYABLE), ensureAccount(tx, companyId, payFrom)]);
      const lines = [
        reportAmount > 0 && { accountId: payable.id, debit: reportAmount, credit: 0, memo: "経費精算(従業員立替分)と相殺" },
        diff > 0 && { accountId: cash.id, debit: diff, credit: 0, memo: `仮払金の残りを返してもらった(${PAY_FROM[payFrom]})` },
        { accountId: advanceAccount.id, debit: 0, credit: advance.amount, memo: "仮払金の精算" },
        diff < 0 && { accountId: cash.id, debit: 0, credit: -diff, memo: `足りない分を支払(${PAY_FROM[payFrom]})` },
      ].filter((l): l is { accountId: string; debit: number; credit: number; memo: string } => !!l);
      const entry = await tx.journalEntry.create({
        data: {
          companyId,
          date: new Date(`${date}T00:00:00Z`),
          description: `仮払金の精算: ${advance.employee.name}さん ${advance.purpose}`,
          sourceType: "REIMBURSEMENT",
          status: "POSTED_MANUALLY",
          lines: { create: lines },
        },
      });
      await tx.cashAdvance.update({ where: { id }, data: { settleEntryId: entry.id } });
      if (reportId) await tx.expenseReport.update({ where: { id: reportId }, data: { reimbursementEntryId: entry.id } });
      return { advance, reportAmount, diff };
    }),
  );
}

// 精算の取消: 精算の仕訳を取り消し、経費精算を未精算に戻す
export async function undoSettlement(companyId: string, id: string) {
  const advance = await prisma.cashAdvance.findFirst({ where: { id, companyId }, include: { employee: { select: { name: true } } } });
  if (!advance || advance.status !== "SETTLED") throw new UserError("精算した仮払金ではありません");
  return withBooksClosed(() =>
    prisma.$transaction(async (tx) => {
      const released = await tx.cashAdvance.updateMany({
        where: { id, companyId, status: "SETTLED", settleEntryId: advance.settleEntryId },
        data: { status: "OPEN", settledDate: null, expenseReportId: null, settleEntryId: null },
      });
      if (released.count !== 1) throw new UserError("状態が変わりました。画面を更新してもう一度お試しください");
      if (advance.expenseReportId) await tx.expenseReport.updateMany({ where: { id: advance.expenseReportId, companyId }, data: { reimbursedAt: null, reimbursementEntryId: null } });
      if (advance.settleEntryId) await tx.journalEntry.update({ where: { id: advance.settleEntryId }, data: { status: "VOID" } });
      return advance;
    }),
  );
}

// 渡したことの取消(誤って登録したとき)。精算前のものだけ
export async function cancelCashAdvance(companyId: string, id: string) {
  const advance = await prisma.cashAdvance.findFirst({ where: { id, companyId }, include: { employee: { select: { name: true } } } });
  if (!advance) throw new UserError("仮払金が見つかりません");
  return withBooksClosed(() =>
    prisma.$transaction(async (tx) => {
      const cancelled = await tx.cashAdvance.updateMany({ where: { id, companyId, status: "OPEN" }, data: { status: "CANCELLED" } });
      if (cancelled.count !== 1) throw new UserError("精算した仮払金は取り消せません。先に精算を取り消してください");
      await tx.journalEntry.update({ where: { id: advance.issueEntryId }, data: { status: "VOID" } });
      return advance;
    }),
  );
}

// 渡してから30日以上たっても精算していない仮払金(やることリスト用)
export function countStaleAdvances(companyId: string, now = new Date()) {
  return prisma.cashAdvance.count({ where: { companyId, status: "OPEN", paidDate: { lt: new Date(Date.parse(`${jstDateKey(now)}T00:00:00Z`) - 30 * 86_400_000) } } });
}

// 従業員が自分の受け取った仮払金を確かめる用
export async function myOpenAdvances(companyId: string, userId: string) {
  const list = await prisma.cashAdvance.findMany({ where: { companyId, employeeId: userId, status: "OPEN" }, orderBy: { paidDate: "asc" } });
  return list.map((a) => ({ id: a.id, purpose: a.purpose, amount: a.amount, paidDate: jstDateKey(a.paidDate) }));
}

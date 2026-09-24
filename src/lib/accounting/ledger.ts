import { prisma } from "@/lib/prisma";
import type { AccountCategory } from "@prisma/client";
import type { DateRange } from "./period";

// Journal entries only affect the books once posted; PENDING_REVIEW items
// are provisional and VOID ones were rejected, so both are excluded here.
const POSTED_STATUSES = ["AUTO_POSTED", "POSTED_MANUALLY"] as const;

export type NormalSide = "DEBIT" | "CREDIT";

export function normalSide(category: AccountCategory): NormalSide {
  return category === "ASSET" || category === "EXPENSE" ? "DEBIT" : "CREDIT";
}

export function signedMovement(side: NormalSide, debit: number, credit: number): number {
  return side === "DEBIT" ? debit - credit : credit - debit;
}

export async function getAccountBalances(companyId: string, range: DateRange = {}) {
  const accounts = await prisma.account.findMany({ where: { companyId }, orderBy: { code: "asc" } });
  const lines = await prisma.journalLine.findMany({
    where: {
      journalEntry: {
        companyId,
        status: { in: [...POSTED_STATUSES] },
        ...(range.gte || range.lt ? { date: range } : {}),
      },
    },
    select: { accountId: true, debit: true, credit: true },
  });

  const totals = new Map<string, { debit: number; credit: number }>();
  for (const line of lines) {
    const current = totals.get(line.accountId) ?? { debit: 0, credit: 0 };
    current.debit += line.debit;
    current.credit += line.credit;
    totals.set(line.accountId, current);
  }

  return accounts.map((account) => {
    const { debit, credit } = totals.get(account.id) ?? { debit: 0, credit: 0 };
    const side = normalSide(account.category);
    return {
      account,
      totalDebit: debit,
      totalCredit: credit,
      balance: signedMovement(side, debit, credit),
      normalSide: side,
    };
  });
}

export async function getAccountLedger(companyId: string, accountId: string) {
  const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
  if (account.companyId !== companyId) throw new Error("Account does not belong to company");

  const lines = await prisma.journalLine.findMany({
    where: { accountId, journalEntry: { companyId, status: { in: [...POSTED_STATUSES] } } },
    include: { journalEntry: true },
    orderBy: [{ journalEntry: { date: "asc" } }, { id: "asc" }],
  });

  const side = normalSide(account.category);
  let balance = 0;
  const entries = lines.map((line) => {
    balance += signedMovement(side, line.debit, line.credit);
    return {
      id: line.id,
      date: line.journalEntry.date,
      description: line.journalEntry.description,
      memo: line.memo,
      debit: line.debit,
      credit: line.credit,
      balance,
    };
  });

  return { account, normalSide: side, entries, closingBalance: balance };
}

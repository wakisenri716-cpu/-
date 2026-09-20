import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

// MVP simplification: all settlements are assumed to move through the bank
// account (1020 普通預金). Cash/other payment methods are a future extension.
const BANK_ACCOUNT_CODE = "1020";

async function getAccountByCode(tx: Prisma.TransactionClient, companyId: string, code: string) {
  const account = await tx.account.findUnique({ where: { companyId_code: { companyId, code } } });
  if (!account) throw new Error(`Account with code ${code} not found for company ${companyId}`);
  return account;
}

export async function recordInvoicePayment(invoiceId: string, amount: number, paymentDate: Date) {
  if (amount <= 0) throw new Error("Payment amount must be positive");

  return prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.findUniqueOrThrow({
      where: { id: invoiceId },
      include: { payments: true },
    });

    if (invoice.status === "PENDING_REVIEW" || invoice.status === "DRAFT" || invoice.status === "CANCELLED") {
      throw new Error("この請求書はまだ確定していないため入金・支払を記録できません");
    }

    const alreadyPaid = invoice.payments.reduce((sum, payment) => sum + payment.amount, 0);
    const remaining = invoice.totalAmount - alreadyPaid;
    if (amount > remaining) {
      throw new Error(`Payment amount exceeds remaining balance (残高 ¥${remaining.toLocaleString()})`);
    }

    const bankAccount = await getAccountByCode(tx, invoice.companyId, BANK_ACCOUNT_CODE);
    const counterAccountCode = invoice.direction === "RECEIVED" ? "2010" : "1110"; // 買掛金 or 売掛金
    const counterAccount = await getAccountByCode(tx, invoice.companyId, counterAccountCode);

    const lines: Prisma.JournalLineUncheckedCreateWithoutJournalEntryInput[] =
      invoice.direction === "RECEIVED"
        ? [
            { accountId: counterAccount.id, debit: amount, credit: 0, memo: "買掛金消込" },
            { accountId: bankAccount.id, debit: 0, credit: amount, memo: "支払" },
          ]
        : [
            { accountId: bankAccount.id, debit: amount, credit: 0, memo: "入金" },
            { accountId: counterAccount.id, debit: 0, credit: amount, memo: "売掛金消込" },
          ];

    const entry = await tx.journalEntry.create({
      data: {
        companyId: invoice.companyId,
        date: paymentDate,
        description:
          invoice.direction === "RECEIVED"
            ? `支払消込: ${invoice.invoiceNumber ?? invoice.id}`
            : `入金消込: ${invoice.invoiceNumber ?? invoice.id}`,
        sourceType: "PAYMENT",
        status: "AUTO_POSTED",
        createdByAi: false,
        lines: { create: lines },
      },
    });

    const payment = await tx.payment.create({
      data: { companyId: invoice.companyId, invoiceId: invoice.id, amount, paymentDate, journalEntryId: entry.id },
    });

    const totalPaid = alreadyPaid + amount;
    await tx.invoice.update({
      where: { id: invoice.id },
      data: { status: totalPaid >= invoice.totalAmount ? "PAID" : "PARTIALLY_PAID" },
    });

    return { payment, entry, remainingAfter: invoice.totalAmount - totalPaid };
  });
}

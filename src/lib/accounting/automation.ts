import { prisma } from "@/lib/prisma";
import type { Prisma, SourceType } from "@prisma/client";

const DEFAULT_MIN_CONFIDENCE = Number(process.env.AI_AUTO_CONFIDENCE_THRESHOLD || 0.9);

export type AutomationDecision = {
  auto: boolean;
  minConfidence: number;
  maxAutoAmount: number | null;
  reason: string;
};

export async function evaluateAutomation(
  companyId: string,
  sourceType: SourceType,
  confidence: number,
  amount: number,
): Promise<AutomationDecision> {
  const rule = await prisma.automationRule.findUnique({
    where: { companyId_sourceType: { companyId, sourceType } },
  });

  const minConfidence = rule?.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  const maxAutoAmount = rule?.maxAutoAmount ?? null;
  const enabled = rule?.enabled ?? true;

  if (!enabled) {
    return { auto: false, minConfidence, maxAutoAmount, reason: "自動化ルールが無効化されています" };
  }
  if (confidence < minConfidence) {
    return {
      auto: false,
      minConfidence,
      maxAutoAmount,
      reason: `AI信頼度 ${confidence.toFixed(2)} が閾値 ${minConfidence.toFixed(2)} を下回っています`,
    };
  }
  if (maxAutoAmount != null && amount > maxAutoAmount) {
    return {
      auto: false,
      minConfidence,
      maxAutoAmount,
      reason: `金額 ¥${amount.toLocaleString()} が自動処理上限 ¥${maxAutoAmount.toLocaleString()} を超えています`,
    };
  }
  return { auto: true, minConfidence, maxAutoAmount, reason: "AI信頼度・金額とも自動処理条件を満たしています" };
}

async function getAccountByCode(tx: Prisma.TransactionClient, companyId: string, code: string) {
  const account = await tx.account.findUnique({ where: { companyId_code: { companyId, code } } });
  if (!account) throw new Error(`Account with code ${code} not found for company ${companyId}`);
  return account;
}

/**
 * Posts (or queues for review) the double-entry journal entry for a single
 * expense report line item, based on the AI extraction already attached to it.
 */
export async function postExpenseItemJournal(expenseItemId: string) {
  return prisma.$transaction(async (tx) => {
    const item = await tx.expenseItem.findUniqueOrThrow({
      where: { id: expenseItemId },
      include: { aiExtraction: true, account: true, expenseReport: true },
    });
    if (!item.aiExtraction || !item.account) {
      throw new Error("Expense item is missing AI extraction or account assignment");
    }

    const decision = await evaluateAutomation(
      item.expenseReport.companyId,
      "EXPENSE_ITEM",
      item.aiExtraction.confidence,
      item.amount,
    );

    const payableAccount = await getAccountByCode(tx, item.expenseReport.companyId, "2020"); // 未払金

    const entry = await tx.journalEntry.create({
      data: {
        companyId: item.expenseReport.companyId,
        date: item.expenseDate,
        description: item.description,
        sourceType: "EXPENSE_ITEM",
        status: decision.auto ? "AUTO_POSTED" : "PENDING_REVIEW",
        createdByAi: true,
        lines: {
          create: [
            { accountId: item.account.id, debit: item.amount, credit: 0, memo: item.description },
            { accountId: payableAccount.id, debit: 0, credit: item.amount, memo: "従業員立替分" },
          ],
        },
      },
    });

    await tx.expenseItem.update({ where: { id: item.id }, data: { journalEntryId: entry.id } });
    await tx.aiExtraction.update({
      where: { id: item.aiExtraction.id },
      data: { status: decision.auto ? "AUTO_APPLIED" : "NEEDS_REVIEW" },
    });
    await tx.expenseReport.update({
      where: { id: item.expenseReportId },
      data: { status: decision.auto ? "AUTO_APPROVED" : "PENDING_REVIEW" },
    });

    return { entry, decision };
  });
}

/**
 * Posts (or queues for review) the double-entry journal entry for an invoice,
 * handling both issued (sales) and received (expense/payable) directions.
 */
export async function postInvoiceJournal(invoiceId: string) {
  return prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.findUniqueOrThrow({
      where: { id: invoiceId },
      include: { aiExtraction: true },
    });
    if (!invoice.aiExtraction) {
      throw new Error("Invoice is missing AI extraction");
    }

    const decision = await evaluateAutomation(
      invoice.companyId,
      "INVOICE",
      invoice.aiExtraction.confidence,
      invoice.totalAmount,
    );

    const lines: Prisma.JournalLineUncheckedCreateWithoutJournalEntryInput[] = [];

    if (invoice.direction === "RECEIVED") {
      const expenseAccount = await getAccountByCode(
        tx,
        invoice.companyId,
        invoice.aiExtraction.suggestedAccountCode || "5990",
      );
      const taxAccount = await getAccountByCode(tx, invoice.companyId, "1220"); // 仮払消費税
      const payableAccount = await getAccountByCode(tx, invoice.companyId, "2010"); // 買掛金

      lines.push({ accountId: expenseAccount.id, debit: invoice.subtotalAmount, credit: 0, memo: "仕入・経費計上" });
      if (invoice.taxAmount > 0) {
        lines.push({ accountId: taxAccount.id, debit: invoice.taxAmount, credit: 0, memo: "仮払消費税" });
      }
      lines.push({ accountId: payableAccount.id, debit: 0, credit: invoice.totalAmount, memo: "買掛金計上" });
    } else {
      const receivableAccount = await getAccountByCode(tx, invoice.companyId, "1110"); // 売掛金
      const salesAccount = await getAccountByCode(tx, invoice.companyId, "4010"); // 売上高
      const taxAccount = await getAccountByCode(tx, invoice.companyId, "2110"); // 仮受消費税

      lines.push({ accountId: receivableAccount.id, debit: invoice.totalAmount, credit: 0, memo: "売掛金計上" });
      lines.push({ accountId: salesAccount.id, debit: 0, credit: invoice.subtotalAmount, memo: "売上計上" });
      if (invoice.taxAmount > 0) {
        lines.push({ accountId: taxAccount.id, debit: 0, credit: invoice.taxAmount, memo: "仮受消費税" });
      }
    }

    const entry = await tx.journalEntry.create({
      data: {
        companyId: invoice.companyId,
        date: invoice.issueDate ?? new Date(),
        description:
          invoice.direction === "RECEIVED"
            ? `受領請求書計上: ${invoice.invoiceNumber ?? invoice.id}`
            : `売上請求書計上: ${invoice.invoiceNumber ?? invoice.id}`,
        sourceType: "INVOICE",
        status: decision.auto ? "AUTO_POSTED" : "PENDING_REVIEW",
        createdByAi: true,
        lines: { create: lines },
      },
    });

    await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        journalEntryId: entry.id,
        status: decision.auto ? "CONFIRMED" : "PENDING_REVIEW",
      },
    });
    await tx.aiExtraction.update({
      where: { id: invoice.aiExtraction.id },
      data: { status: decision.auto ? "AUTO_APPLIED" : "NEEDS_REVIEW" },
    });

    return { entry, decision };
  });
}

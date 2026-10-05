import { prisma } from "@/lib/prisma";
import { ensureChartOfAccounts } from "@/lib/accounting/accounts";
import { postExpenseItemJournal } from "@/lib/accounting/automation";

// 決まった金額(出張の日当・登録した経路の交通費など)を、本人の経費精算に明細として入れる。
// 作成中・差戻しの経費精算があればそこへ、なければ新しく作る。AIの読み取りはしないので信頼度1として扱う。

type Actor = { id: string; companyId: string };
export type QuickItem = { description: string; amount: number; date: string };

export async function addItemsToExpenses(user: Actor, items: QuickItem[], source: string, accountCode = "5010") {
  await ensureChartOfAccounts(user.companyId);
  const account = await prisma.account.findUniqueOrThrow({ where: { companyId_code: { companyId: user.companyId, code: accountCode } } });
  const report =
    (await prisma.expenseReport.findFirst({ where: { companyId: user.companyId, employeeId: user.id, approvalStatus: { in: ["DRAFT", "RETURNED"] }, reimbursedAt: null }, orderBy: { createdAt: "desc" } })) ??
    (await prisma.expenseReport.create({ data: { companyId: user.companyId, employeeId: user.id, status: "DRAFT" } }));
  for (const it of items) {
    const extraction = await prisma.aiExtraction.create({
      data: { companyId: user.companyId, sourceType: "EXPENSE_ITEM", rawResponse: { source, ...it }, confidence: 1, suggestedAccountCode: accountCode, status: "NEEDS_REVIEW" },
    });
    const item = await prisma.expenseItem.create({
      data: { expenseReportId: report.id, description: it.description.slice(0, 300), amount: it.amount, expenseDate: new Date(`${it.date}T00:00:00Z`), accountId: account.id, aiExtractionId: extraction.id },
    });
    await postExpenseItemJournal(item.id);
  }
  const total = items.reduce((s, i) => s + i.amount, 0);
  await prisma.expenseReport.update({ where: { id: report.id }, data: { totalAmount: { increment: total }, submittedAt: report.submittedAt ?? new Date() } });
  return { reportId: report.id, total };
}

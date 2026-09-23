import { prisma } from "@/lib/prisma";
import { requireCompanyId } from "@/lib/auth/session";

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

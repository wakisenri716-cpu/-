import { prisma } from "@/lib/prisma";
import { getDefaultCompanyId } from "@/lib/demo";

export async function getDashboardSummary() {
  const companyId = await getDefaultCompanyId();

  const [autoPosted, pendingReview, postedManually, recentEntries] = await Promise.all([
    prisma.journalEntry.count({ where: { companyId, status: "AUTO_POSTED" } }),
    prisma.journalEntry.count({ where: { companyId, status: "PENDING_REVIEW" } }),
    prisma.journalEntry.count({ where: { companyId, status: "POSTED_MANUALLY" } }),
    prisma.journalEntry.findMany({
      where: { companyId, status: { not: "VOID" } },
      include: { lines: { include: { account: true } } },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);

  const totalHandled = autoPosted + pendingReview + postedManually;
  const automationRate = totalHandled === 0 ? 0 : autoPosted / totalHandled;

  return { autoPosted, pendingReview, postedManually, automationRate, recentEntries };
}

import { prisma } from "@/lib/prisma";
import type { PosProvider } from "@prisma/client";
import { ensureAccount } from "@/lib/accounting/accounts";
import { jstDateKey } from "@/lib/jst";
import type { NormalizedPosSale } from "./types";

export const PROVIDER_LABELS: Record<PosProvider, string> = {
  SMAREGI: "スマレジ",
  AIRREGI: "Airレジ",
};

function signedLine(accountId: string, amount: number, memo: string) {
  // 返品などで合計がマイナスになった場合は貸借を入れ替えて正の金額で記帳する
  return amount >= 0
    ? { accountId, debit: amount, credit: 0, memo }
    : { accountId, debit: 0, credit: -amount, memo };
}

export async function importPosSales(
  companyId: string,
  provider: PosProvider,
  sales: NormalizedPosSale[],
  options: { demo?: boolean } = {},
) {
  return prisma.$transaction(
    async (tx) => {
      const created = await tx.posSale.createMany({
        data: sales.map((sale) => ({
          companyId,
          provider,
          externalId: sale.externalId,
          soldAt: sale.soldAt,
          businessDate: jstDateKey(sale.soldAt),
          storeName: sale.storeName,
          totalAmount: sale.totalAmount,
          taxAmount: sale.taxAmount,
          cashAmount: sale.cashAmount,
          cashlessAmount: sale.cashlessAmount,
        })),
        skipDuplicates: true,
      });

      const unposted = await tx.posSale.findMany({
        where: { companyId, provider, journalEntryId: null },
        orderBy: { soldAt: "asc" },
      });

      const byDate = new Map<string, typeof unposted>();
      for (const sale of unposted) {
        byDate.set(sale.businessDate, [...(byDate.get(sale.businessDate) ?? []), sale]);
      }

      const [cash, credit, salesAccount, taxAccount] = await Promise.all([
        ensureAccount(tx, companyId, "1010"),
        ensureAccount(tx, companyId, "1115"),
        ensureAccount(tx, companyId, "4010"),
        ensureAccount(tx, companyId, "2110"),
      ]);

      const label = `${options.demo ? "[デモ] " : ""}${PROVIDER_LABELS[provider]}売上`;
      let entriesCreated = 0;

      for (const [businessDate, group] of byDate) {
        const sum = (pick: (s: (typeof group)[number]) => number) => group.reduce((acc, s) => acc + pick(s), 0);
        const total = sum((s) => s.totalAmount);
        const tax = sum((s) => s.taxAmount);
        const cashTotal = sum((s) => s.cashAmount);
        const cashlessTotal = sum((s) => s.cashlessAmount);

        const lines = [
          signedLine(cash.id, cashTotal, "現金売上"),
          signedLine(credit.id, cashlessTotal, "キャッシュレス決済"),
          signedLine(salesAccount.id, -(total - tax), "売上計上"),
          signedLine(taxAccount.id, -tax, "仮受消費税"),
        ].filter((line) => line.debit !== 0 || line.credit !== 0);

        if (lines.length === 0) continue;

        const entry = await tx.journalEntry.create({
          data: {
            companyId,
            // 他の仕訳と同じく日付のみ(UTC 0時)で保持する
            date: new Date(businessDate),
            description: `${label} ${businessDate} (${group.length}件)`,
            sourceType: "POS_SALE",
            status: "AUTO_POSTED",
            createdByAi: false,
            lines: { create: lines },
          },
        });
        await tx.posSale.updateMany({
          where: { id: { in: group.map((s) => s.id) } },
          data: { journalEntryId: entry.id },
        });
        entriesCreated++;
      }

      return {
        received: sales.length,
        imported: created.count,
        duplicates: sales.length - created.count,
        entriesCreated,
      };
    },
    { timeout: 30_000 },
  );
}

export async function getPosSummary(companyId: string) {
  const groups = await prisma.posSale.groupBy({
    by: ["provider", "businessDate", "journalEntryId"],
    where: { companyId },
    _count: { _all: true },
    _sum: { totalAmount: true, taxAmount: true, cashAmount: true, cashlessAmount: true },
    orderBy: [{ businessDate: "desc" }],
    take: 60,
  });

  return groups.map((g) => ({
    provider: g.provider,
    businessDate: g.businessDate,
    journalEntryId: g.journalEntryId,
    count: g._count._all,
    totalAmount: g._sum.totalAmount ?? 0,
    taxAmount: g._sum.taxAmount ?? 0,
    cashAmount: g._sum.cashAmount ?? 0,
    cashlessAmount: g._sum.cashlessAmount ?? 0,
  }));
}

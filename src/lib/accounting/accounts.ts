import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { CHART_OF_ACCOUNTS } from "./chartOfAccounts";

// 既存デプロイのDBには後から追加した科目が無いことがあるので、
// シードを再実行しなくても仕訳できるよう、勘定科目マスタから都度作成する。
export async function ensureAccount(tx: Prisma.TransactionClient, companyId: string, code: string) {
  const seed = CHART_OF_ACCOUNTS.find((a) => a.code === code);
  if (!seed) throw new Error(`Unknown account code ${code}`);
  return tx.account.upsert({
    where: { companyId_code: { companyId, code } },
    update: {},
    create: { companyId, ...seed },
  });
}

// 勘定科目マスタに後から足した科目を、既存の会社にもまとめて作成する(既存科目は変更しない)。
export async function ensureChartOfAccounts(companyId: string) {
  await prisma.account.createMany({
    data: CHART_OF_ACCOUNTS.map((a) => ({ companyId, ...a })),
    skipDuplicates: true,
  });
}

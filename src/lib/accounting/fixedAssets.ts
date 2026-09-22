import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

// MVP simplification: acquisitions are assumed paid from the bank account
// (1020 普通預金), and depreciation always uses the straight-line method
// (定額法) — the most common method for small businesses under Japanese tax
// rules. Other payment sources and methods (定率法) are a future extension.
const ASSET_ACCOUNT_CODE = "1510"; // 固定資産
const ACCUMULATED_DEPRECIATION_ACCOUNT_CODE = "1519"; // 減価償却累計額
const DEPRECIATION_EXPENSE_ACCOUNT_CODE = "5100"; // 減価償却費
const BANK_ACCOUNT_CODE = "1020"; // 普通預金

async function getAccountByCode(tx: Prisma.TransactionClient, companyId: string, code: string) {
  const account = await tx.account.findUnique({ where: { companyId_code: { companyId, code } } });
  if (!account) throw new Error(`Account with code ${code} not found for company ${companyId}`);
  return account;
}

export function calcMonthlyDepreciation(acquisitionCost: number, residualValue: number, usefulLifeYears: number) {
  const depreciableBase = acquisitionCost - residualValue;
  const totalMonths = usefulLifeYears * 12;
  return Math.floor(depreciableBase / totalMonths);
}

export async function registerFixedAsset(
  companyId: string,
  input: { name: string; acquisitionDate: Date; acquisitionCost: number; usefulLifeYears: number; residualValue: number },
) {
  if (input.acquisitionCost <= 0) throw new Error("取得価額は正の数で入力してください");
  if (input.usefulLifeYears <= 0) throw new Error("耐用年数は1年以上で入力してください");
  if (input.residualValue < 0 || input.residualValue >= input.acquisitionCost) {
    throw new Error("残存価額は0以上、取得価額未満で入力してください");
  }

  return prisma.$transaction(async (tx) => {
    const assetAccount = await getAccountByCode(tx, companyId, ASSET_ACCOUNT_CODE);
    const bankAccount = await getAccountByCode(tx, companyId, BANK_ACCOUNT_CODE);

    const entry = await tx.journalEntry.create({
      data: {
        companyId,
        date: input.acquisitionDate,
        description: `固定資産取得: ${input.name}`,
        sourceType: "FIXED_ASSET",
        status: "AUTO_POSTED",
        createdByAi: false,
        lines: {
          create: [
            { accountId: assetAccount.id, debit: input.acquisitionCost, credit: 0, memo: "固定資産計上" },
            { accountId: bankAccount.id, debit: 0, credit: input.acquisitionCost, memo: "取得代金支払" },
          ],
        },
      },
    });

    const asset = await tx.fixedAsset.create({
      data: {
        companyId,
        name: input.name,
        acquisitionDate: input.acquisitionDate,
        acquisitionCost: input.acquisitionCost,
        usefulLifeYears: input.usefulLifeYears,
        residualValue: input.residualValue,
        journalEntryId: entry.id,
      },
    });

    return asset;
  });
}

export async function postDepreciation(fixedAssetId: string, period: string) {
  if (!/^\d{4}-\d{2}$/.test(period)) throw new Error("period must be in YYYY-MM format");

  return prisma.$transaction(async (tx) => {
    const asset = await tx.fixedAsset.findUniqueOrThrow({
      where: { id: fixedAssetId },
      include: { depreciationEntries: true },
    });

    if (asset.depreciationEntries.some((e) => e.period === period)) {
      throw new Error(`${period} 分はすでに計上済みです`);
    }

    const accumulated = asset.depreciationEntries.reduce((sum, e) => sum + e.amount, 0);
    const depreciableBase = asset.acquisitionCost - asset.residualValue;
    const remaining = depreciableBase - accumulated;
    if (remaining <= 0) {
      throw new Error("この資産はすでに減価償却が完了しています");
    }

    const monthly = calcMonthlyDepreciation(asset.acquisitionCost, asset.residualValue, asset.usefulLifeYears);
    const amount = Math.min(monthly, remaining);

    const expenseAccount = await getAccountByCode(tx, asset.companyId, DEPRECIATION_EXPENSE_ACCOUNT_CODE);
    const accumulatedAccount = await getAccountByCode(tx, asset.companyId, ACCUMULATED_DEPRECIATION_ACCOUNT_CODE);

    const [year, month] = period.split("-").map(Number);
    const entry = await tx.journalEntry.create({
      data: {
        companyId: asset.companyId,
        date: new Date(Date.UTC(year, month - 1, 1)),
        description: `減価償却費計上: ${asset.name} (${period})`,
        sourceType: "FIXED_ASSET",
        status: "AUTO_POSTED",
        createdByAi: false,
        lines: {
          create: [
            { accountId: expenseAccount.id, debit: amount, credit: 0, memo: "減価償却費" },
            { accountId: accumulatedAccount.id, debit: 0, credit: amount, memo: "減価償却累計額" },
          ],
        },
      },
    });

    const depreciationEntry = await tx.depreciationEntry.create({
      data: { fixedAssetId: asset.id, period, amount, journalEntryId: entry.id },
    });

    return { depreciationEntry, entry, remainingAfter: remaining - amount };
  });
}

export async function getFixedAssetsWithSummary(companyId: string) {
  const assets = await prisma.fixedAsset.findMany({
    where: { companyId },
    include: { depreciationEntries: { orderBy: { period: "asc" } } },
    orderBy: { acquisitionDate: "asc" },
  });

  return assets.map((asset) => {
    const accumulatedDepreciation = asset.depreciationEntries.reduce((sum, e) => sum + e.amount, 0);
    const bookValue = asset.acquisitionCost - accumulatedDepreciation;
    const monthlyDepreciation = calcMonthlyDepreciation(asset.acquisitionCost, asset.residualValue, asset.usefulLifeYears);
    const fullyDepreciated = accumulatedDepreciation >= asset.acquisitionCost - asset.residualValue;
    return { ...asset, accumulatedDepreciation, bookValue, monthlyDepreciation, fullyDepreciated };
  });
}

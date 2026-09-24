import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { ensureAccount } from "./accounts";

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

    if (asset.disposedAt) throw new Error("除却・売却した資産は減価償却できません");
    if (period < asset.acquisitionDate.toISOString().slice(0, 7)) throw new Error("取得した月より前の減価償却は計上できません");
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

// 当月分(period)の減価償却を、計上できる資産すべてにまとめて計上する
export async function postDepreciationForAll(companyId: string, period: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new Error("月の指定が正しくありません");
  const assets = await getFixedAssetsWithSummary(companyId);
  const targets = assets.filter(
    (a) => !a.disposedAt && !a.fullyDepreciated && a.acquisitionDate.toISOString().slice(0, 7) <= period && !a.depreciationEntries.some((e) => e.period === period),
  );
  let total = 0;
  const errors: string[] = [];
  for (const a of targets) {
    try {
      total += (await postDepreciation(a.id, period)).depreciationEntry.amount;
    } catch (error) {
      errors.push(`${a.name}: ${error instanceof Error ? error.message : "失敗しました"}`);
    }
  }
  return { posted: targets.length - errors.length, total, errors };
}

const DISPOSAL_GAIN_ACCOUNT_CODE = "4030"; // 固定資産売却益
const DISPOSAL_LOSS_ACCOUNT_CODE = "5160"; // 固定資産除売却損
const RECEIVE_TO = { "1020": "普通預金", "1010": "現金" } as const;

// 除却(売却額0)・売却。取得価額と減価償却累計額を消し、帳簿価額と売却額の差を売却益/除売却損にする。
// 売却時の消費税(仮受消費税)は扱わない簡易版。
export async function disposeFixedAsset(companyId: string, id: string, input: { date: string; price: number; receiveTo?: string }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || Number.isNaN(Date.parse(input.date))) throw new Error("日付を正しく入力してください");
  if (!Number.isInteger(input.price) || input.price < 0) throw new Error("売却額は0以上の整数で入力してください(除却なら0)");
  const receiveTo = (input.receiveTo ?? "1020") as keyof typeof RECEIVE_TO;
  if (!(receiveTo in RECEIVE_TO)) throw new Error("入金先を選んでください");

  const asset = (await getFixedAssetsWithSummary(companyId)).find((a) => a.id === id);
  if (!asset) throw new Error("固定資産が見つかりません");
  if (asset.disposedAt) throw new Error("この資産はすでに除却・売却しています");
  if (input.date < asset.acquisitionDate.toISOString().slice(0, 10)) throw new Error("取得日より前には除却・売却できません");

  const gain = input.price - asset.bookValue;
  const label = input.price > 0 ? "売却" : "除却";
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.fixedAsset.updateMany({ where: { id, companyId, disposedAt: null }, data: { disposedAt: new Date(`${input.date}T00:00:00Z`), disposalPrice: input.price } });
    if (claimed.count !== 1) throw new Error("この資産はすでに除却・売却しています");
    const [assetAcc, accumulatedAcc, cashAcc, gainAcc, lossAcc] = await Promise.all([
      ensureAccount(tx, companyId, ASSET_ACCOUNT_CODE),
      ensureAccount(tx, companyId, ACCUMULATED_DEPRECIATION_ACCOUNT_CODE),
      ensureAccount(tx, companyId, receiveTo),
      ensureAccount(tx, companyId, DISPOSAL_GAIN_ACCOUNT_CODE),
      ensureAccount(tx, companyId, DISPOSAL_LOSS_ACCOUNT_CODE),
    ]);
    const lines = [
      ...(asset.accumulatedDepreciation > 0 ? [{ accountId: accumulatedAcc.id, debit: asset.accumulatedDepreciation, credit: 0, memo: "減価償却累計額の消去" }] : []),
      ...(input.price > 0 ? [{ accountId: cashAcc.id, debit: input.price, credit: 0, memo: "売却代金" }] : []),
      ...(gain < 0 ? [{ accountId: lossAcc.id, debit: -gain, credit: 0, memo: `固定資産${label}損` }] : []),
      { accountId: assetAcc.id, debit: 0, credit: asset.acquisitionCost, memo: "固定資産の消去" },
      ...(gain > 0 ? [{ accountId: gainAcc.id, debit: 0, credit: gain, memo: "固定資産売却益" }] : []),
    ];
    const entry = await tx.journalEntry.create({
      data: {
        companyId,
        date: new Date(`${input.date}T00:00:00Z`),
        description: `固定資産${label}: ${asset.name}`,
        sourceType: "FIXED_ASSET",
        status: "AUTO_POSTED",
        lines: { create: lines },
      },
    });
    await tx.fixedAsset.update({ where: { id }, data: { disposalEntryId: entry.id } });
    return { asset, gain, entry };
  });
}

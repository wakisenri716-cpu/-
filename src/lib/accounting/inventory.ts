import { prisma } from "@/lib/prisma";
import type { Prisma, StockMovementType } from "@prisma/client";
import { ensureAccount } from "./accounts";

const INVENTORY_ACCOUNT = "1310"; // 商品
const COST_OF_SALES_ACCOUNT = "5000"; // 売上原価
const INPUT_TAX_ACCOUNT = "1220"; // 仮払消費税
export const PURCHASE_PAYMENT_ACCOUNTS = ["1010", "1020", "2010"] as const; // 現金 / 普通預金 / 買掛金
const TAX_RATE = 0.1;

export type StockMovementInput = {
  productId: string;
  type: StockMovementType;
  date: Date;
  // 入庫・出庫では動かした数、棚卸では実際に数えた数
  quantity: number;
  unitCost?: number;
  paymentAccountCode?: string;
  taxable?: boolean;
  memo?: string | null;
};

export class InventoryError extends Error {}

type Line = Prisma.JournalLineUncheckedCreateWithoutJournalEntryInput;

export async function createProduct(companyId: string, data: { name: string; unit: string; code: string | null }) {
  try {
    return await prisma.product.create({ data: { companyId, ...data } });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      throw new InventoryError(`「${data.name}」はすでに登録されています`);
    }
    throw error;
  }
}

// 出庫・棚卸減で減らす在庫金額。全数を払い出すときは端数を残さないよう残高をそのまま使う。
function costOf(quantity: number, onHand: number, value: number): number {
  return quantity === onHand ? value : Math.round((value * quantity) / onHand);
}

export async function recordStockMovement(companyId: string, input: StockMovementInput) {
  const { type, quantity } = input;
  if (!Number.isInteger(quantity) || quantity < 0 || (type !== "STOCKTAKE" && quantity === 0)) {
    throw new InventoryError("数量を正しく入力してください");
  }

  return prisma.$transaction(async (tx) => {
    // 同時に記録されても在庫数・金額がズレないよう、この商品の行をロックしてから読む
    await tx.$queryRaw`SELECT id FROM "Product" WHERE id = ${input.productId} FOR UPDATE`;
    const product = await tx.product.findFirst({ where: { id: input.productId, companyId } });
    if (!product) throw new InventoryError("商品が見つかりません");

    const onHand = product.quantityOnHand;
    const value = product.inventoryValue;
    const [inventory, costOfSales] = await Promise.all([
      ensureAccount(tx, companyId, INVENTORY_ACCOUNT),
      ensureAccount(tx, companyId, COST_OF_SALES_ACCOUNT),
    ]);

    let quantityChange: number;
    let valueChange: number;
    let description: string;
    let lines: Line[] = [];

    if (type === "PURCHASE") {
      const unitCost = input.unitCost ?? 0;
      if (!Number.isInteger(unitCost) || unitCost <= 0) throw new InventoryError("仕入単価を正しく入力してください");
      const paymentCode = input.paymentAccountCode ?? "2010";
      if (!(PURCHASE_PAYMENT_ACCOUNTS as readonly string[]).includes(paymentCode)) {
        throw new InventoryError("支払方法を選択してください");
      }
      const amount = quantity * unitCost;
      const tax = input.taxable ? Math.floor(amount * TAX_RATE) : 0;
      const payment = await ensureAccount(tx, companyId, paymentCode);

      quantityChange = quantity;
      valueChange = amount;
      description = `仕入: ${product.name} ${quantity}${product.unit} @¥${unitCost.toLocaleString("ja-JP")}`;
      lines = [{ accountId: inventory.id, debit: amount, credit: 0, memo: "商品仕入" }];
      if (tax > 0) {
        const inputTax = await ensureAccount(tx, companyId, INPUT_TAX_ACCOUNT);
        lines.push({ accountId: inputTax.id, debit: tax, credit: 0, memo: "仮払消費税" });
      }
      lines.push({ accountId: payment.id, debit: 0, credit: amount + tax, memo: "仕入代金" });
    } else if (type === "ISSUE") {
      if (quantity > onHand) {
        throw new InventoryError(`在庫が足りません(現在 ${onHand}${product.unit})`);
      }
      const cost = costOf(quantity, onHand, value);
      quantityChange = -quantity;
      valueChange = -cost;
      description = `出庫: ${product.name} ${quantity}${product.unit}`;
      lines = [
        { accountId: costOfSales.id, debit: cost, credit: 0, memo: "売上原価" },
        { accountId: inventory.id, debit: 0, credit: cost, memo: "商品払出" },
      ];
    } else {
      const diff = quantity - onHand;
      quantityChange = diff;
      description = `棚卸: ${product.name} 帳簿 ${onHand}${product.unit} → 実数 ${quantity}${product.unit}`;
      if (diff < 0) {
        const cost = costOf(-diff, onHand, value);
        valueChange = -cost;
        lines = [
          { accountId: costOfSales.id, debit: cost, credit: 0, memo: "棚卸減" },
          { accountId: inventory.id, debit: 0, credit: cost, memo: "棚卸減" },
        ];
      } else if (diff > 0) {
        if (onHand === 0) {
          throw new InventoryError("在庫が0の商品は単価が分からないため、棚卸ではなく「入庫」で数量と単価を登録してください");
        }
        const gain = Math.round((value / onHand) * diff);
        valueChange = gain;
        lines = [
          { accountId: inventory.id, debit: gain, credit: 0, memo: "棚卸増" },
          { accountId: costOfSales.id, debit: 0, credit: gain, memo: "棚卸増" },
        ];
      } else {
        valueChange = 0;
      }
    }

    lines = lines.filter((line) => line.debit !== 0 || line.credit !== 0);
    const entry =
      lines.length > 0
        ? await tx.journalEntry.create({
            data: {
              companyId,
              date: input.date,
              description,
              sourceType: "INVENTORY",
              status: "AUTO_POSTED",
              createdByAi: false,
              lines: { create: lines },
            },
          })
        : null;

    const movement = await tx.stockMovement.create({
      data: {
        productId: product.id,
        type,
        date: input.date,
        quantity: quantityChange,
        amount: valueChange,
        memo: input.memo || null,
        journalEntryId: entry?.id,
      },
    });
    const updated = await tx.product.update({
      where: { id: product.id },
      data: { quantityOnHand: onHand + quantityChange, inventoryValue: value + valueChange },
    });

    return { movement, product: updated, journalEntryId: entry?.id ?? null };
  });
}

export async function getInventory(companyId: string) {
  const [products, movements] = await Promise.all([
    prisma.product.findMany({ where: { companyId }, orderBy: [{ code: "asc" }, { name: "asc" }] }),
    prisma.stockMovement.findMany({
      where: { product: { companyId } },
      include: { product: { select: { name: true, unit: true } } },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: 50,
    }),
  ]);

  return {
    products: products.map((p) => ({
      ...p,
      averageUnitCost: p.quantityOnHand > 0 ? Math.round(p.inventoryValue / p.quantityOnHand) : 0,
    })),
    movements,
    totalValue: products.reduce((sum, p) => sum + p.inventoryValue, 0),
  };
}

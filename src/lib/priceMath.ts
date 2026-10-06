// 値上げの計算(画面でもすぐ計算し直せるよう、データベースを使わない部分だけ)

// 値上げした場合の1か月の利益の増え方。原価(売上原価)は売る数に合わせて減り、ほかの費用は変わらない前提
export function simulatePriceIncrease(monthly: { revenue: number; costOfSales: number; expense: number }, raisePct: number, lossPct: number) {
  const p = raisePct / 100;
  const v = lossPct / 100;
  const revenue = Math.round(monthly.revenue * (1 + p) * (1 - v));
  const costOfSales = Math.round(monthly.costOfSales * (1 - v));
  const expense = monthly.expense - monthly.costOfSales + costOfSales;
  const profit = revenue - expense;
  const baseProfit = monthly.revenue - monthly.expense;
  // 利益が変わらない、お客さまの減り方の上限(損益分岐)
  const contribution = monthly.revenue - monthly.costOfSales;
  const breakEvenLoss = contribution > 0 ? Math.round((1 - contribution / (monthly.revenue * (1 + p) - monthly.costOfSales)) * 1000) / 10 : null;
  return { raisePct, lossPct, revenue, expense, profit, baseProfit, diff: profit - baseProfit, breakEvenLoss };
}

// 新しい価格(10円単位に丸める)
export const newPrice = (price: number, raisePct: number) => Math.round((price * (1 + raisePct / 100)) / 10) * 10;

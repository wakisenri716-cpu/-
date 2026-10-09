import { prisma } from "@/lib/prisma";
import { dueDateFor, readTerms } from "@/lib/paymentTerms";

// 顧客の支払条件から支払期限を出す(条件がなければ null)。名前は前後の空白を除いて同じものを探す
export async function termsDueDate(companyId: string, customerName: string, issueDate: string) {
  const name = customerName.trim();
  if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(issueDate)) return null;
  const c = await prisma.customer.findFirst({ where: { companyId, name }, select: { closingDay: true, payMonths: true, payDay: true, holidayRule: true } });
  const t = readTerms(c);
  return t ? dueDateFor(t, issueDate) : null;
}

// 翌月末(支払条件がないときの期限)
export function endOfNextMonth(issueDate: string) {
  const [y, m] = issueDate.split("-").map(Number);
  return new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
}

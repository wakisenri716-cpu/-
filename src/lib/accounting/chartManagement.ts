import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import type { AccountCategory } from "@prisma/client";
import { ensureChartOfAccounts } from "./accounts";

// 科目コードの先頭の数字で区分を決める(1 資産 / 2 負債 / 3 純資産 / 4 収益 / 5〜9 費用)。帳票の並びと合うようにするため。
export function categoryForCode(code: string): AccountCategory {
  const head = code[0];
  if (head === "1") return "ASSET";
  if (head === "2") return "LIABILITY";
  if (head === "3") return "EQUITY";
  if (head === "4") return "REVENUE";
  return "EXPENSE";
}

export const CATEGORY_LABELS: Record<AccountCategory, string> = { ASSET: "資産", LIABILITY: "負債", EQUITY: "純資産", REVENUE: "収益", EXPENSE: "費用" };

export async function listChart(companyId: string) {
  await ensureChartOfAccounts(companyId);
  const [accounts, usage] = await Promise.all([
    prisma.account.findMany({ where: { companyId }, orderBy: { code: "asc" } }),
    prisma.journalLine.groupBy({ by: ["accountId"], where: { account: { companyId } }, _count: { _all: true } }),
  ]);
  const used = new Map(usage.map((u) => [u.accountId, u._count._all]));
  return accounts.map((a) => ({ id: a.id, code: a.code, name: a.name, category: a.category, hidden: a.hidden, lineCount: used.get(a.id) ?? 0 }));
}

async function checkName(companyId: string, name: string, exceptId?: string) {
  if (!name) throw new UserError("科目名を入力してください");
  if (name.length > 30) throw new UserError("科目名は30文字以内にしてください");
  const dup = await prisma.account.findFirst({ where: { companyId, name, ...(exceptId ? { id: { not: exceptId } } : {}) } });
  if (dup) throw new UserError(`「${name}」はすでにあります(${dup.code})`);
}

export async function createAccount(companyId: string, input: { code: string; name: string }) {
  const code = input.code.normalize("NFKC").trim();
  const name = input.name.normalize("NFKC").trim();
  if (!/^[1-9]\d{3}$/.test(code)) throw new UserError("科目コードは4桁の数字で入力してください(1〜で資産、2〜負債、3〜純資産、4〜収益、5〜費用)");
  if (await prisma.account.findUnique({ where: { companyId_code: { companyId, code } } })) throw new UserError(`科目コード ${code} はすでに使われています`);
  await checkName(companyId, name);
  return prisma.account.create({ data: { companyId, code, name, category: categoryForCode(code) } });
}

export async function updateAccount(companyId: string, id: string, input: { name?: string; hidden?: boolean }) {
  const account = await prisma.account.findFirst({ where: { id, companyId } });
  if (!account) throw new UserError("勘定科目が見つかりません");
  const name = input.name?.normalize("NFKC").trim();
  if (name !== undefined && name !== account.name) await checkName(companyId, name, id);
  return prisma.account.update({
    where: { id },
    data: { ...(name !== undefined ? { name } : {}), ...(typeof input.hidden === "boolean" ? { hidden: input.hidden } : {}) },
  });
}

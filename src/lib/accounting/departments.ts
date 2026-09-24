import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import type { DateRange } from "./period";

const POSTED = ["AUTO_POSTED", "POSTED_MANUALLY"] as const;

export async function listDepartments(companyId: string) {
  return prisma.department.findMany({ where: { companyId }, orderBy: [{ active: "desc" }, { createdAt: "asc" }], select: { id: true, name: true, active: true } });
}

async function checkName(companyId: string, name: string, exceptId?: string) {
  if (!name) throw new UserError("部門名を入力してください");
  if (name.length > 30) throw new UserError("部門名は30文字以内にしてください");
  if (await prisma.department.findFirst({ where: { companyId, name, ...(exceptId ? { id: { not: exceptId } } : {}) } })) {
    throw new UserError(`「${name}」はすでにあります`);
  }
}

export async function createDepartment(companyId: string, rawName: string) {
  const name = rawName.normalize("NFKC").trim();
  await checkName(companyId, name);
  return prisma.department.create({ data: { companyId, name } });
}

export async function updateDepartment(companyId: string, id: string, input: { name?: string; active?: boolean }) {
  const dept = await prisma.department.findFirst({ where: { id, companyId } });
  if (!dept) throw new UserError("部門が見つかりません");
  const name = input.name?.normalize("NFKC").trim();
  if (name !== undefined && name !== dept.name) await checkName(companyId, name, id);
  return prisma.department.update({ where: { id }, data: { ...(name !== undefined ? { name } : {}), ...(typeof input.active === "boolean" ? { active: input.active } : {}) } });
}

// 仕訳に付ける部門が、この会社の使用中の部門か確かめる(null は「部門なし」)
export async function resolveDepartmentId(companyId: string, departmentId: string | null | undefined) {
  if (!departmentId) return null;
  const dept = await prisma.department.findFirst({ where: { id: departmentId, companyId, active: true } });
  if (!dept) throw new UserError("部門が見つかりません(使用中の部門を選んでください)");
  return dept.id;
}

// 仕訳の部門を付け替える(締めた期間の仕訳はデータベースのトリガーが拒否する)
export async function setEntryDepartment(companyId: string, entryId: string, departmentId: string | null) {
  const resolved = await resolveDepartmentId(companyId, departmentId);
  const updated = await prisma.journalEntry.updateMany({ where: { id: entryId, companyId }, data: { departmentId: resolved } });
  if (updated.count !== 1) throw new UserError("仕訳が見つかりません");
}

// 部門別の損益: 収益・費用の科目ごとに、部門ごとの金額を並べる(部門の付いていない仕訳は「未設定」)
export async function getDepartmentPL(companyId: string, range: DateRange = {}) {
  const [departments, lines] = await Promise.all([
    prisma.department.findMany({ where: { companyId }, orderBy: { createdAt: "asc" } }),
    prisma.journalLine.findMany({
      where: {
        account: { companyId, category: { in: ["REVENUE", "EXPENSE"] } },
        journalEntry: { companyId, status: { in: [...POSTED] }, ...(range.gte || range.lt ? { date: range } : {}) },
      },
      select: { debit: true, credit: true, account: { select: { id: true, code: true, name: true, category: true } }, journalEntry: { select: { departmentId: true } } },
    }),
  ]);
  const UNASSIGNED = "none";
  const used = new Set(lines.map((l) => l.journalEntry.departmentId ?? UNASSIGNED));
  const columns = [
    ...departments.filter((d) => d.active || used.has(d.id)).map((d) => ({ id: d.id, name: d.name })),
    ...(used.has(UNASSIGNED) ? [{ id: UNASSIGNED, name: "未設定" }] : []),
  ];

  type Row = { accountId: string; code: string; name: string; category: string; amounts: Record<string, number>; total: number };
  const rows = new Map<string, Row>();
  for (const l of lines) {
    const row = rows.get(l.account.id) ?? { accountId: l.account.id, code: l.account.code, name: l.account.name, category: l.account.category, amounts: {}, total: 0 };
    const col = l.journalEntry.departmentId ?? UNASSIGNED;
    const amount = l.account.category === "REVENUE" ? l.credit - l.debit : l.debit - l.credit;
    row.amounts[col] = (row.amounts[col] ?? 0) + amount;
    row.total += amount;
    rows.set(l.account.id, row);
  }
  const sorted = [...rows.values()].filter((r) => r.total !== 0 || Object.values(r.amounts).some((v) => v !== 0)).sort((a, b) => a.code.localeCompare(b.code));
  const revenue = sorted.filter((r) => r.category === "REVENUE");
  const expense = sorted.filter((r) => r.category === "EXPENSE");
  const sum = (rs: Row[]) => {
    const amounts: Record<string, number> = {};
    for (const c of columns) amounts[c.id] = rs.reduce((s, r) => s + (r.amounts[c.id] ?? 0), 0);
    return { amounts, total: rs.reduce((s, r) => s + r.total, 0) };
  };
  const revenueTotal = sum(revenue);
  const expenseTotal = sum(expense);
  const profit = {
    amounts: Object.fromEntries(columns.map((c) => [c.id, revenueTotal.amounts[c.id] - expenseTotal.amounts[c.id]])),
    total: revenueTotal.total - expenseTotal.total,
  };
  return { columns, revenue, expense, revenueTotal, expenseTotal, profit };
}

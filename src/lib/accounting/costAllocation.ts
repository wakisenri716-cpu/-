import { prisma } from "@/lib/prisma";
import { UserError, toBooksClosedError } from "@/lib/errors";
import { ensureAccount, ensureChartOfAccounts } from "@/lib/accounting/accounts";
import { monthEnd } from "./allocations";

// 部門配賦: 部門の付いていない共通の費用(本部の家賃・水道光熱費など)を、決めた割合か売上の比で部門(店舗)に振り分ける。
// 部門は仕訳ごとに付けるので、2段階で振り分ける:
//   ① 部門なし: 配賦仮勘定 / 費用(共通の費用を部門なしから外す)
//   ② 部門ごと: 費用 / 配賦仮勘定(部門を付けて費用を入れる)
// 配賦仮勘定は①と②で必ず0に戻る。

const POSTED = ["AUTO_POSTED", "POSTED_MANUALLY"] as const;
const CLEARING = "1290"; // 配賦仮勘定
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
export const BASIS = { FIXED: "決めた割合", REVENUE: "その月の売上の比" } as const;
type Basis = keyof typeof BASIS;
type Weights = Record<string, number>;

const monthRange = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) };
};

type Input = { name?: unknown; accountCodes?: unknown; basis?: unknown; weights?: unknown };

async function parse(companyId: string, input: Input) {
  const name = String(input.name ?? "").normalize("NFKC").trim();
  if (!name) throw new UserError("名前を入力してください(例: 本部の家賃)");
  if (name.length > 30) throw new UserError("名前は30文字以内にしてください");
  const codes = [...new Set(Array.isArray(input.accountCodes) ? input.accountCodes.map(String) : [])];
  if (!codes.length) throw new UserError("配賦する費用の科目を選んでください");
  const accounts = await prisma.account.findMany({ where: { companyId, code: { in: codes }, category: "EXPENSE" } });
  if (accounts.length !== codes.length) throw new UserError("配賦できるのは費用の科目だけです");
  const basis = String(input.basis ?? "FIXED") as Basis;
  if (!(basis in BASIS)) throw new UserError("配賦の基準を選んでください");

  const departments = await prisma.department.findMany({ where: { companyId, active: true }, select: { id: true } });
  const raw = (input.weights && typeof input.weights === "object" ? input.weights : {}) as Record<string, unknown>;
  const weights: Weights = {};
  for (const d of departments) {
    const v = raw[d.id];
    if (v === undefined || v === null || v === "" || v === false) continue;
    const n = v === true ? 1 : Number(String(v).normalize("NFKC"));
    if (!Number.isFinite(n) || n < 0 || n > 1_000_000) throw new UserError("割合は0以上の数で入力してください");
    if (n > 0) weights[d.id] = basis === "REVENUE" ? 1 : n;
  }
  if (Object.keys(weights).length < 1) throw new UserError(basis === "FIXED" ? "配賦先の部門に割合を入れてください" : "配賦先の部門を選んでください");
  return { name, accountCodes: codes, basis, weights };
}

export async function listCostAllocations(companyId: string) {
  await ensureChartOfAccounts(companyId);
  const [allocations, departments, accounts] = await Promise.all([
    prisma.costAllocation.findMany({ where: { companyId }, include: { runs: { orderBy: { month: "desc" }, take: 12 } }, orderBy: { createdAt: "asc" } }),
    prisma.department.findMany({ where: { companyId }, orderBy: [{ active: "desc" }, { createdAt: "asc" }], select: { id: true, name: true, active: true } }),
    prisma.account.findMany({ where: { companyId, category: "EXPENSE", hidden: false }, orderBy: { code: "asc" }, select: { code: true, name: true } }),
  ]);
  return { allocations, departments, accounts };
}

export async function createCostAllocation(companyId: string, input: Input) {
  return prisma.costAllocation.create({ data: { companyId, ...(await parse(companyId, input)) } });
}

async function find(companyId: string, id: string) {
  const a = await prisma.costAllocation.findFirst({ where: { id, companyId } });
  if (!a) throw new UserError("配賦の設定が見つかりません");
  return a;
}

export async function updateCostAllocation(companyId: string, id: string, input: Input & { active?: unknown }) {
  await find(companyId, id);
  if (typeof input.active === "boolean" && input.name === undefined) return prisma.costAllocation.update({ where: { id }, data: { active: input.active } });
  return prisma.costAllocation.update({ where: { id }, data: await parse(companyId, input) });
}

export async function deleteCostAllocation(companyId: string, id: string) {
  const a = await find(companyId, id);
  if (await prisma.costAllocationRun.count({ where: { allocationId: id } })) throw new UserError("配賦した月があるため削除できません。先に配賦を取り消すか、「止める」にしてください");
  await prisma.costAllocation.delete({ where: { id } });
  return a;
}

// 金額を割合で分ける。端数は割合のいちばん大きい部門に寄せて、合計をぴったり合わせる
export function splitAmount(amount: number, weights: { id: string; weight: number }[]) {
  const total = weights.reduce((s, w) => s + w.weight, 0);
  const parts = weights.map((w) => ({ id: w.id, amount: total > 0 ? Math.floor((amount * w.weight) / total) : 0 }));
  const rest = amount - parts.reduce((s, p) => s + p.amount, 0);
  if (rest && parts.length) {
    const top = weights.reduce((best, w, i) => (w.weight > weights[best].weight ? i : best), 0);
    parts[top].amount += rest;
  }
  return parts;
}

// その月の配賦の見込み(実行前の確認用。実行もこれを使う)
export async function previewCostAllocation(companyId: string, id: string, monthValue: unknown) {
  const allocation = await find(companyId, id);
  const month = String(monthValue ?? "");
  if (!MONTH.test(month)) throw new UserError("月を正しく選んでください");
  const range = monthRange(month);
  const weights = allocation.weights as Weights;
  const [accounts, departments, lines, run] = await Promise.all([
    prisma.account.findMany({ where: { companyId, code: { in: allocation.accountCodes } }, orderBy: { code: "asc" } }),
    prisma.department.findMany({ where: { companyId, id: { in: Object.keys(weights) } }, orderBy: { createdAt: "asc" } }),
    // 部門の付いていない仕訳の、その科目の金額
    prisma.journalLine.findMany({
      where: { account: { companyId, code: { in: allocation.accountCodes } }, journalEntry: { companyId, status: { in: [...POSTED] }, departmentId: null, date: range } },
      select: { debit: true, credit: true, account: { select: { code: true } } },
    }),
    prisma.costAllocationRun.findUnique({ where: { allocationId_month: { allocationId: id, month } } }),
  ]);

  // 売上の比で分けるときは、その月の部門ごとの売上
  let basisWeights = departments.map((d) => ({ id: d.id, weight: weights[d.id] ?? 0 }));
  if (allocation.basis === "REVENUE") {
    const revenue = await prisma.journalLine.findMany({
      where: { account: { companyId, category: "REVENUE" }, journalEntry: { companyId, status: { in: [...POSTED] }, departmentId: { in: departments.map((d) => d.id) }, date: range } },
      select: { debit: true, credit: true, journalEntry: { select: { departmentId: true } } },
    });
    const byDept = new Map<string, number>();
    for (const l of revenue) byDept.set(l.journalEntry.departmentId!, (byDept.get(l.journalEntry.departmentId!) ?? 0) + l.credit - l.debit);
    basisWeights = departments.map((d) => ({ id: d.id, weight: Math.max(0, byDept.get(d.id) ?? 0) }));
  }
  const totalWeight = basisWeights.reduce((s, w) => s + w.weight, 0);

  const byAccount = new Map<string, number>();
  for (const l of lines) byAccount.set(l.account.code, (byAccount.get(l.account.code) ?? 0) + l.debit - l.credit);
  const accountRows = accounts.map((a) => ({ code: a.code, name: a.name, amount: Math.max(0, byAccount.get(a.code) ?? 0) })).filter((a) => a.amount > 0);
  const total = accountRows.reduce((s, a) => s + a.amount, 0);

  const shares = new Map(departments.map((d) => [d.id, { amount: 0, accounts: {} as Record<string, number> }]));
  if (totalWeight > 0) {
    for (const a of accountRows) {
      for (const p of splitAmount(a.amount, basisWeights)) {
        const s = shares.get(p.id)!;
        s.amount += p.amount;
        if (p.amount) s.accounts[a.code] = p.amount;
      }
    }
  }
  return {
    allocation: { id: allocation.id, name: allocation.name, basis: allocation.basis },
    month,
    total,
    accounts: accountRows,
    departments: departments.map((d) => {
      const w = basisWeights.find((b) => b.id === d.id)!.weight;
      return { id: d.id, name: d.name, weight: w, ratio: totalWeight > 0 ? w / totalWeight : 0, amount: shares.get(d.id)!.amount, accounts: shares.get(d.id)!.accounts };
    }),
    problem: run
      ? `${month.slice(0, 4)}年${Number(month.slice(5))}月はもう配賦しています(取り消すとやり直せます)`
      : !allocation.active
        ? "止めている設定です"
        : total === 0
          ? "この月に、部門の付いていない対象の費用はありません"
          : totalWeight === 0
            ? "この月は配賦先の部門に売上がないため、売上の比で分けられません"
            : null,
    run: run ? { id: run.id, createdAt: run.createdAt } : null,
  };
}

export async function runCostAllocation(companyId: string, id: string, monthValue: unknown) {
  const preview = await previewCostAllocation(companyId, id, monthValue);
  if (preview.problem) throw new UserError(preview.problem);
  const date = monthEnd(preview.month);
  const label = `部門配賦「${preview.allocation.name}」${Number(preview.month.slice(5))}月分`;
  try {
    return await prisma.$transaction(async (tx) => {
      const clearing = await ensureAccount(tx, companyId, CLEARING);
      const ids = new Map<string, string>();
      for (const a of preview.accounts) ids.set(a.code, (await ensureAccount(tx, companyId, a.code)).id);
      const entry = (description: string, departmentId: string | null, lines: { accountId: string; debit: number; credit: number; memo: string }[]) =>
        tx.journalEntry.create({ data: { companyId, date, description, sourceType: "DEPT_ALLOCATION", status: "POSTED_MANUALLY", departmentId, lines: { create: lines } } });
      // ① 部門なしから外す
      const source = await entry(`${label}(共通費を部門へ)`, null, [
        { accountId: clearing.id, debit: preview.total, credit: 0, memo: "配賦仮勘定" },
        ...preview.accounts.map((a) => ({ accountId: ids.get(a.code)!, debit: 0, credit: a.amount, memo: "共通費の配賦" })),
      ]);
      // ② 部門ごとに入れる
      const entryIds = [source.id];
      for (const d of preview.departments.filter((x) => x.amount > 0)) {
        const e = await entry(`${label}(${d.name})`, d.id, [
          ...Object.entries(d.accounts).map(([code, amount]) => ({ accountId: ids.get(code)!, debit: amount, credit: 0, memo: `共通費の配賦 ${Math.round(d.ratio * 1000) / 10}%` })),
          { accountId: clearing.id, debit: 0, credit: d.amount, memo: "配賦仮勘定" },
        ]);
        entryIds.push(e.id);
      }
      return tx.costAllocationRun.create({
        data: {
          allocationId: id,
          month: preview.month,
          amount: preview.total,
          detail: preview.departments.map((d) => ({ departmentId: d.id, name: d.name, ratio: d.ratio, amount: d.amount })),
          journalEntryIds: entryIds,
        },
      });
    });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") throw new UserError("この月はもう配賦しています");
    throw toBooksClosedError(error) ?? error;
  }
}

// 配賦の取消: 仕訳を取消にして、記録を消す(その月をやり直せる)
export async function undoCostAllocation(companyId: string, runId: string) {
  const run = await prisma.costAllocationRun.findFirst({ where: { id: runId, allocation: { companyId } }, include: { allocation: true } });
  if (!run) throw new UserError("配賦の記録が見つかりません");
  try {
    await prisma.$transaction(async (tx) => {
      await tx.journalEntry.updateMany({ where: { id: { in: run.journalEntryIds }, companyId }, data: { status: "VOID" } });
      await tx.costAllocationRun.delete({ where: { id: run.id } });
    });
  } catch (error) {
    throw toBooksClosedError(error) ?? error;
  }
  return run;
}

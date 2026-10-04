import { prisma } from "@/lib/prisma";
import type { BankRule } from "@prisma/client";
import { UserError } from "@/lib/errors";
import { ensureBankAccounts } from "./accounts";

// 銀行・カード明細の自動仕訳ルール(会社ごと)。取り込みのとき、過去の記帳やキーワードより先に使う。

export const DIRECTIONS = { OUT: "出金・カードの利用", IN: "入金", BOTH: "両方" } as const;
type Direction = keyof typeof DIRECTIONS;

// 銀行の摘要は半角カナ・全角英数が混ざるので、NFKCで全角カナ・半角英数にそろえてから照合する
export function normalizeText(text: string): string {
  return text.normalize("NFKC").toUpperCase().replace(/\s+/g, " ").trim();
}

type Input = {
  keyword?: unknown;
  direction?: unknown;
  minAmount?: unknown;
  maxAmount?: unknown;
  bankAccountId?: unknown;
  accountCode?: unknown;
  autoPost?: unknown;
  memo?: unknown;
};

function amount(value: unknown, label: string) {
  const raw = String(value ?? "").replace(/[,¥円\s]/g, "");
  if (raw === "") return null;
  const n = Number(raw.normalize("NFKC"));
  if (!Number.isInteger(n) || n < 0 || n > 9_999_999_999) throw new UserError(`${label}は0以上の整数で入力してください`);
  return n;
}

async function parse(companyId: string, input: Input) {
  const keyword = String(input.keyword ?? "").normalize("NFKC").trim();
  if (!keyword) throw new UserError("摘要のキーワードを入力してください");
  if (keyword.length > 40) throw new UserError("キーワードは40文字以内で入力してください");
  const direction = String(input.direction ?? "OUT") as Direction;
  if (!(direction in DIRECTIONS)) throw new UserError("入金・出金の向きを選んでください");
  const minAmount = amount(input.minAmount, "金額(以上)");
  const maxAmount = amount(input.maxAmount, "金額(以下)");
  if (minAmount != null && maxAmount != null && minAmount > maxAmount) throw new UserError("金額の範囲が逆になっています");

  const bankAccountId = String(input.bankAccountId ?? "") || null;
  const bank = bankAccountId ? await prisma.bankAccount.findFirst({ where: { id: bankAccountId, companyId }, include: { account: true } }) : null;
  if (bankAccountId && !bank) throw new UserError("口座・カードが見つかりません");

  const accountCode = String(input.accountCode ?? "");
  const account = await prisma.account.findUnique({ where: { companyId_code: { companyId, code: accountCode } } });
  if (!account) throw new UserError("記帳する勘定科目を選んでください");
  if (bank && bank.account.code === accountCode) throw new UserError(`「${bank.name}」の明細を同じ科目では記帳できません`);

  const memo = String(input.memo ?? "").trim();
  if (memo.length > 100) throw new UserError("メモは100文字以内で入力してください");
  return { keyword, direction, minAmount, maxAmount, bankAccountId, accountCode, autoPost: input.autoPost !== false && input.autoPost !== "false", memo: memo || null };
}

export async function listRules(companyId: string) {
  await ensureBankAccounts(companyId);
  const [rules, accounts, banks] = await Promise.all([
    prisma.bankRule.findMany({ where: { companyId }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
    prisma.account.findMany({ where: { companyId }, orderBy: { code: "asc" }, select: { code: true, name: true, category: true, hidden: true } }),
    prisma.bankAccount.findMany({ where: { companyId }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, kind: true, active: true, account: { select: { code: true } } } }),
  ]);
  const nameOf = new Map(accounts.map((a) => [a.code, a.name]));
  const bankOf = new Map(banks.map((b) => [b.id, b.name]));
  return {
    rules: rules.map((r) => ({
      ...r,
      accountName: nameOf.get(r.accountCode) ?? "(削除された科目)",
      bankAccountName: r.bankAccountId ? (bankOf.get(r.bankAccountId) ?? null) : null,
    })),
    accounts: accounts.filter((a) => !a.hidden),
    banks: banks.map((b) => ({ id: b.id, name: b.name, kind: b.kind, active: b.active, accountCode: b.account.code })),
    pending: await prisma.bankTransaction.count({ where: { companyId, status: "PENDING" } }),
  };
}

export async function createRule(companyId: string, input: Input) {
  const data = await parse(companyId, input);
  const last = await prisma.bankRule.findFirst({ where: { companyId }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
  return prisma.bankRule.create({ data: { companyId, ...data, sortOrder: (last?.sortOrder ?? 0) + 1 } });
}

async function findRule(companyId: string, id: string) {
  const rule = await prisma.bankRule.findFirst({ where: { id, companyId } });
  if (!rule) throw new UserError("ルールが見つかりません");
  return rule;
}

export async function updateRule(companyId: string, id: string, input: Input & { active?: unknown; move?: unknown }) {
  const rule = await findRule(companyId, id);
  // 上へ・下へ: となりのルールと順番を入れかえる
  if (input.move === "up" || input.move === "down") {
    const all = await prisma.bankRule.findMany({ where: { companyId }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: { id: true } });
    const i = all.findIndex((r) => r.id === id);
    const j = input.move === "up" ? i - 1 : i + 1;
    if (j < 0 || j >= all.length) return rule;
    [all[i], all[j]] = [all[j], all[i]];
    await prisma.$transaction(all.map((r, k) => prisma.bankRule.update({ where: { id: r.id }, data: { sortOrder: k + 1 } })));
    return findRule(companyId, id);
  }
  if (typeof input.active === "boolean" && input.keyword === undefined) {
    return prisma.bankRule.update({ where: { id }, data: { active: input.active } });
  }
  return prisma.bankRule.update({ where: { id }, data: await parse(companyId, input) });
}

export async function deleteRule(companyId: string, id: string) {
  const rule = await findRule(companyId, id);
  await prisma.bankRule.delete({ where: { id } });
  return rule;
}

export async function activeRules(companyId: string) {
  return prisma.bankRule.findMany({ where: { companyId, active: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
}

type RowLike = { description: string; withdrawal: number; deposit: number };

// 当てはまる最初のルール。カードの返品・取消(入金)は、利用(出金)のルールで判定する
export function matchRule(rules: BankRule[], row: RowLike, bank: { id: string; kind: string; code: string }) {
  const text = normalizeText(row.description);
  const out = row.withdrawal > 0 || (bank.kind === "CARD" && row.deposit > 0);
  const value = row.withdrawal || row.deposit;
  return (
    rules.find(
      (r) =>
        (r.direction === "BOTH" || r.direction === (out ? "OUT" : "IN")) &&
        (!r.bankAccountId || r.bankAccountId === bank.id) &&
        (r.minAmount == null || value >= r.minAmount) &&
        (r.maxAmount == null || value <= r.maxAmount) &&
        r.accountCode !== bank.code &&
        text.includes(normalizeText(r.keyword)),
    ) ?? null
  );
}

// 使った回数と最後に使った日(どのルールが効いているかを画面に出す)
export async function countHits(hits: Map<string, number>) {
  const now = new Date();
  await Promise.all([...hits].map(([id, n]) => prisma.bankRule.updateMany({ where: { id }, data: { hits: { increment: n }, lastUsedAt: now } })));
}

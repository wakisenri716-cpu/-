import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import { ensureChartOfAccounts } from "@/lib/accounting/accounts";

// 明細を取り込む銀行口座・クレジットカード。
// 口座は「普通預金(〇〇銀行)」、カードは「未払金(〇〇カード)」という専用の勘定科目を自動で作り、明細の仕訳はその科目で行う。
// 最初の口座は、これまでの「1020 普通預金」をそのまま使う。

export type BankAccountKind = "BANK" | "CARD";

export const DEFAULT_BANK_CODE = "1020";
const POSTED = ["AUTO_POSTED", "POSTED_MANUALLY"] as const;
// 新しく作る科目のコードの範囲
const CODE_RANGE: Record<BankAccountKind, [number, number]> = { BANK: [1021, 1099], CARD: [2031, 2099] };

export const KIND_LABELS: Record<BankAccountKind, string> = { BANK: "銀行口座", CARD: "クレジットカード" };

const normalizeKeyword = (text: string) => text.normalize("NFKC").toUpperCase().replace(/\s+/g, "");

// まだ口座が1つもない会社には、「普通預金」(1020)を最初の口座として作り、これまでの明細をその口座に入れる
export async function ensureBankAccounts(companyId: string) {
  let first = await prisma.bankAccount.findFirst({ where: { companyId }, orderBy: { createdAt: "asc" } });
  if (!first) {
    await ensureChartOfAccounts(companyId);
    const account = await prisma.account.findUniqueOrThrow({ where: { companyId_code: { companyId, code: DEFAULT_BANK_CODE } } });
    try {
      first = await prisma.bankAccount.create({ data: { companyId, name: "普通預金", kind: "BANK", accountId: account.id } });
    } catch (error) {
      // 同時に開いた別の画面が先に作った場合
      if ((error as { code?: string }).code !== "P2002") throw error;
      first = await prisma.bankAccount.findFirstOrThrow({ where: { companyId }, orderBy: { createdAt: "asc" } });
    }
  }
  await prisma.bankTransaction.updateMany({ where: { companyId, bankAccountId: null }, data: { bankAccountId: first.id } });
  return first;
}

export async function getBankAccount(companyId: string, id: string | null | undefined) {
  const first = await ensureBankAccounts(companyId);
  if (!id) return prisma.bankAccount.findUniqueOrThrow({ where: { id: first.id }, include: { account: true } });
  const found = await prisma.bankAccount.findFirst({ where: { id, companyId }, include: { account: true } });
  if (!found) throw new UserError("口座・カードが見つかりません");
  return found;
}

// 口座・カードの一覧と、それぞれの残高(カードは未払いの利用額)・確認待ちの件数
export async function listBankAccounts(companyId: string) {
  await ensureBankAccounts(companyId);
  const accounts = await prisma.bankAccount.findMany({
    where: { companyId },
    orderBy: { createdAt: "asc" },
    include: { account: { select: { id: true, code: true, name: true } } },
  });
  const [sums, pending, latest] = await Promise.all([
    prisma.journalLine.groupBy({
      by: ["accountId"],
      where: { accountId: { in: accounts.map((a) => a.accountId) }, journalEntry: { companyId, status: { in: [...POSTED] } } },
      _sum: { debit: true, credit: true },
    }),
    prisma.bankTransaction.groupBy({ by: ["bankAccountId"], where: { companyId, status: "PENDING" }, _count: { _all: true } }),
    prisma.bankTransaction.groupBy({ by: ["bankAccountId"], where: { companyId }, _max: { date: true } }),
  ]);
  const sumBy = new Map(sums.map((s) => [s.accountId, (s._sum.debit ?? 0) - (s._sum.credit ?? 0)]));
  const pendingBy = new Map(pending.map((p) => [p.bankAccountId, p._count._all]));
  const latestBy = new Map(latest.map((l) => [l.bankAccountId, l._max.date]));
  return accounts.map((a) => {
    const net = sumBy.get(a.accountId) ?? 0;
    return {
      id: a.id,
      name: a.name,
      kind: a.kind as BankAccountKind,
      active: a.active,
      debitKeyword: a.debitKeyword,
      accountCode: a.account.code,
      accountName: a.account.name,
      // 口座は預金残高、カードは未払い(これから引き落とされる)額
      balance: a.kind === "CARD" ? -net : net,
      pending: pendingBy.get(a.id) ?? 0,
      lastDate: latestBy.get(a.id) ?? null,
    };
  });
}

function checkName(raw: unknown) {
  const name = String(raw ?? "").normalize("NFKC").trim();
  if (!name) throw new UserError("口座・カードの名前を入力してください(例: みずほ銀行、楽天カード)");
  if (name.length > 30) throw new UserError("名前は30文字以内にしてください");
  return name;
}

function checkKeyword(raw: unknown) {
  if (raw === undefined || raw === null) return null;
  const keyword = String(raw).normalize("NFKC").trim();
  if (keyword.length > 30) throw new UserError("引落しの目印は30文字以内にしてください");
  return keyword || null;
}

export async function createBankAccount(companyId: string, input: { name?: unknown; kind?: unknown; debitKeyword?: unknown }) {
  await ensureBankAccounts(companyId);
  const name = checkName(input.name);
  if (input.kind !== "BANK" && input.kind !== "CARD") throw new UserError("銀行口座かクレジットカードかを選んでください");
  const kind: BankAccountKind = input.kind;
  const debitKeyword = kind === "CARD" ? checkKeyword(input.debitKeyword) : null;
  if (await prisma.bankAccount.findFirst({ where: { companyId, name } })) throw new UserError(`「${name}」はすでに登録されています`);

  const accountName = kind === "BANK" ? `普通預金(${name})` : `未払金(${name})`;
  const used = new Set((await prisma.account.findMany({ where: { companyId }, select: { code: true } })).map((a) => a.code));
  const [from, to] = CODE_RANGE[kind];
  let code: string | null = null;
  for (let n = from; n <= to; n++) {
    if (!used.has(String(n))) {
      code = String(n);
      break;
    }
  }
  if (!code) throw new UserError("これ以上登録できません。使わなくなった口座・カードを整理してください");

  try {
    return await prisma.$transaction(async (tx) => {
      // 同じ名前の科目を手で作っていた場合は、それを使う
      const existing = await tx.account.findFirst({ where: { companyId, name: accountName }, include: { bankAccount: true } });
      if (existing && existing.bankAccount) throw new UserError(`「${accountName}」はすでに別の口座・カードで使われています`);
      const expected = kind === "BANK" ? "ASSET" : "LIABILITY";
      if (existing && existing.category !== expected) throw new UserError(`「${accountName}」という科目が別の区分であります。名前を変えて登録してください`);
      const account =
        existing ??
        (await tx.account.create({ data: { companyId, code: code!, name: accountName, category: expected } }));
      if (account.hidden) await tx.account.update({ where: { id: account.id }, data: { hidden: false } });
      return tx.bankAccount.create({ data: { companyId, name, kind, accountId: account.id, debitKeyword } });
    });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") throw new UserError("同時に登録されたため登録できませんでした。もう一度お試しください");
    throw error;
  }
}

// 名前・引落しの目印の変更と、使わなくなった口座・カードをしまう(明細・仕訳は残る)
export async function updateBankAccount(companyId: string, id: string, input: { name?: unknown; debitKeyword?: unknown; active?: unknown }) {
  const current = await prisma.bankAccount.findFirst({ where: { id, companyId } });
  if (!current) throw new UserError("口座・カードが見つかりません");
  const data: { name?: string; debitKeyword?: string | null; active?: boolean } = {};
  if (input.name !== undefined) {
    data.name = checkName(input.name);
    if (data.name !== current.name && (await prisma.bankAccount.findFirst({ where: { companyId, name: data.name } }))) {
      throw new UserError(`「${data.name}」はすでに登録されています`);
    }
  }
  if (input.debitKeyword !== undefined) {
    if (current.kind !== "CARD") throw new UserError("引落しの目印はクレジットカードだけに設定できます");
    data.debitKeyword = checkKeyword(input.debitKeyword);
  }
  if (typeof input.active === "boolean") {
    if (!input.active) {
      const first = await ensureBankAccounts(companyId);
      if (first.id === id) throw new UserError("最初の口座(普通預金)はしまえません");
      if (await prisma.bankTransaction.count({ where: { bankAccountId: id, status: "PENDING" } })) throw new UserError("確認待ちの明細が残っています。先に処理してください");
    }
    data.active = input.active;
  }
  try {
    return await prisma.bankAccount.update({ where: { id }, data });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") throw new UserError("同じ名前の口座・カードがあります");
    throw error;
  }
}

// 現金・預金として数える科目(現金・普通預金と、登録した銀行口座の科目)
export async function cashAccountCodes(companyId: string) {
  const banks = await prisma.bankAccount.findMany({ where: { companyId, kind: "BANK" }, select: { account: { select: { code: true } } } });
  return [...new Set(["1010", DEFAULT_BANK_CODE, ...banks.map((b) => b.account.code)])];
}

// 銀行の明細の摘要に、カードの「引落しの目印」が入っていれば、そのカードを返す
export async function cardsWithKeyword(companyId: string) {
  const cards = await prisma.bankAccount.findMany({
    where: { companyId, kind: "CARD", debitKeyword: { not: null } },
    select: { name: true, debitKeyword: true, account: { select: { code: true } } },
  });
  return cards
    .filter((c) => c.debitKeyword)
    .map((c) => ({ name: c.name, code: c.account.code, keyword: normalizeKeyword(c.debitKeyword!) }))
    .filter((c) => c.keyword);
}

export function matchesKeyword(description: string, keyword: string) {
  return normalizeKeyword(description).includes(keyword);
}

import { prisma } from "@/lib/prisma";
import { UserError, toBooksClosedError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { ensureAccount, ensureChartOfAccounts } from "@/lib/accounting/accounts";
import { cashAccountCodes } from "@/lib/bank/accounts";

// 外貨建ての取引: 計上したときのレートで円にして「売掛金 / 売上」「費用 / 買掛金」を記帳し、
// 入金・支払いのときに実際に動いた円との差を、為替差益(4040)・為替差損(5180)にする。

export const CURRENCIES: Record<string, { name: string; digits: number }> = {
  USD: { name: "米ドル", digits: 2 },
  EUR: { name: "ユーロ", digits: 2 },
  GBP: { name: "英ポンド", digits: 2 },
  CNY: { name: "人民元", digits: 2 },
  KRW: { name: "韓国ウォン", digits: 0 },
  TWD: { name: "台湾ドル", digits: 2 },
  HKD: { name: "香港ドル", digits: 2 },
  SGD: { name: "シンガポールドル", digits: 2 },
  AUD: { name: "豪ドル", digits: 2 },
  THB: { name: "タイバーツ", digits: 2 },
  VND: { name: "ベトナムドン", digits: 0 },
};

const AR = "1110";
const AP = "2010";
const GAIN = "4040";
const LOSS = "5180";
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// 「1,234.56」→ 最小単位の整数(セントなど)。小数の桁が多すぎるときはエラー
export function toMinor(value: unknown, digits: number) {
  const s = String(value ?? "").normalize("NFKC").replace(/[,\s]/g, "");
  const m = s.match(/^(\d+)(?:\.(\d+))?$/);
  if (!m) return null;
  if ((m[2] ?? "").length > digits) return null;
  return BigInt(m[1]) * BigInt(10) ** BigInt(digits) + BigInt((m[2] ?? "").padEnd(digits, "0") || "0");
}

export function formatForeign(minor: bigint, currency: string) {
  const digits = CURRENCIES[currency]?.digits ?? 2;
  const neg = minor < BigInt(0);
  const abs = neg ? -minor : minor;
  const unit = BigInt(10) ** BigInt(digits);
  const whole = (abs / unit).toLocaleString("en-US");
  const frac = digits ? `.${(abs % unit).toString().padStart(digits, "0")}` : "";
  return `${neg ? "-" : ""}${currency} ${whole}${frac}`;
}

// レートは小数第6位まで(1通貨あたりの円)
function rateMicro(value: unknown) {
  const s = String(value ?? "").normalize("NFKC").replace(/[,\s円]/g, "");
  const m = s.match(/^(\d+)(?:\.(\d{1,6}))?$/);
  if (!m) return null;
  const micro = BigInt(m[1]) * BigInt(1000000) + BigInt((m[2] ?? "").padEnd(6, "0"));
  return micro > BigInt(0) ? micro : null;
}

// 外貨 × レート を円に(四捨五入)
export function toJpy(minor: bigint, micro: bigint, digits: number) {
  const den = BigInt(10) ** BigInt(digits) * BigInt(1000000);
  return Number((minor * micro * BigInt(2) + den) / (den * BigInt(2)));
}

const asDate = (v: unknown, label: string) => {
  const s = String(v ?? "");
  if (!DATE.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) throw new UserError(`${label}を正しく入力してください`);
  return new Date(`${s}T00:00:00Z`);
};

type CreateInput = { kind?: unknown; partner?: unknown; description?: unknown; currency?: unknown; amount?: unknown; rate?: unknown; date?: unknown; dueDate?: unknown; accountCode?: unknown };

export async function createForeignTransaction(companyId: string, input: CreateInput) {
  const kind = input.kind === "PURCHASE" ? "PURCHASE" : input.kind === "SALE" ? "SALE" : null;
  if (!kind) throw new UserError("売上か仕入・経費かを選んでください");
  const partner = String(input.partner ?? "").trim().slice(0, 100);
  if (!partner) throw new UserError("取引先を入力してください");
  const description = String(input.description ?? "").trim().slice(0, 200) || (kind === "SALE" ? "外貨建ての売上" : "外貨建ての仕入・経費");
  const currency = String(input.currency ?? "");
  const cur = CURRENCIES[currency];
  if (!cur) throw new UserError("通貨を選んでください");
  const minor = toMinor(input.amount, cur.digits);
  if (minor === null || minor <= BigInt(0) || minor > BigInt(10) ** BigInt(15)) throw new UserError(`金額を正しく入力してください(${cur.name}は小数${cur.digits}桁まで)`);
  const micro = rateMicro(input.rate);
  if (micro === null) throw new UserError("為替レート(1通貨あたりの円)を正しく入力してください");
  const date = asDate(input.date, "計上日");
  const dueDate = input.dueDate ? asDate(input.dueDate, "入金・支払いの予定日") : null;
  const jpy = toJpy(minor, micro, cur.digits);
  if (jpy <= 0) throw new UserError("円にすると0円になります。金額とレートを確かめてください");

  await ensureChartOfAccounts(companyId);
  const accountCode = String(input.accountCode ?? (kind === "SALE" ? "4010" : "5000"));
  const account = await prisma.account.findUnique({ where: { companyId_code: { companyId, code: accountCode } } });
  const allowed = kind === "SALE" ? ["REVENUE"] : ["EXPENSE", "ASSET"];
  if (!account || !allowed.includes(account.category) || [AR, AP].includes(accountCode)) throw new UserError(kind === "SALE" ? "売上の科目を選んでください" : "仕入・経費の科目を選んでください");

  const label = `${kind === "SALE" ? "外貨建て売上" : "外貨建て仕入"} ${partner} ${formatForeign(minor, currency)}(@${(Number(micro) / 1e6).toString()}円)`;
  try {
    return await prisma.$transaction(async (tx) => {
      const balance = await ensureAccount(tx, companyId, kind === "SALE" ? AR : AP);
      const entry = await tx.journalEntry.create({
        data: {
          companyId,
          date,
          description: `${label} ${description}`.slice(0, 300),
          sourceType: "FOREIGN",
          status: "POSTED_MANUALLY",
          lines: {
            create:
              kind === "SALE"
                ? [
                    { accountId: balance.id, debit: jpy, credit: 0, memo: partner },
                    { accountId: account.id, debit: 0, credit: jpy, memo: description },
                  ]
                : [
                    { accountId: account.id, debit: jpy, credit: 0, memo: description },
                    { accountId: balance.id, debit: 0, credit: jpy, memo: partner },
                  ],
          },
        },
      });
      return tx.foreignTransaction.create({
        data: { companyId, kind, partner, description, currency, amountMinor: minor, rate: (Number(micro) / 1e6).toFixed(6), jpyAmount: jpy, accountCode, date, dueDate, journalEntryId: entry.id },
      });
    });
  } catch (error) {
    throw toBooksClosedError(error) ?? error;
  }
}

async function find(companyId: string, id: string) {
  const t = await prisma.foreignTransaction.findFirst({ where: { id, companyId } });
  if (!t) throw new UserError("取引が見つかりません");
  return t;
}

// 入金・支払い: 実際に動いた円(または当日のレート)で記帳し、差は為替差損益に
export async function settleForeignTransaction(companyId: string, id: string, input: { date?: unknown; jpy?: unknown; rate?: unknown; cashCode?: unknown }) {
  const t = await find(companyId, id);
  if (t.settledAt) throw new UserError("すでに入金・支払い済みです");
  const date = asDate(input.date, input.date ? "日付" : "入金・支払いの日");
  const digits = CURRENCIES[t.currency]?.digits ?? 2;
  let jpy: number;
  if (String(input.jpy ?? "").trim()) {
    jpy = Number(String(input.jpy).normalize("NFKC").replace(/[,¥円\s]/g, ""));
    if (!Number.isInteger(jpy) || jpy <= 0) throw new UserError("入金・支払いした円の金額を正しく入力してください");
  } else {
    const micro = rateMicro(input.rate);
    if (micro === null) throw new UserError("入金・支払いした円の金額か、その日のレートを入力してください");
    jpy = toJpy(t.amountMinor, micro, digits);
  }
  const cashCode = String(input.cashCode ?? "1020");
  if (!(await cashAccountCodes(companyId)).includes(cashCode)) throw new UserError("入金・支払いの口座を選んでください");

  const booked = t.jpyAmount;
  // 売上: 多く入金されたら差益。仕入: 少なく払えたら差益
  const gain = t.kind === "SALE" ? jpy - booked : booked - jpy;
  try {
    return await prisma.$transaction(async (tx) => {
      const [cash, balance] = await Promise.all([ensureAccount(tx, companyId, cashCode), ensureAccount(tx, companyId, t.kind === "SALE" ? AR : AP)]);
      const lines =
        t.kind === "SALE"
          ? [
              { accountId: cash.id, debit: jpy, credit: 0, memo: `${t.partner} 入金` },
              { accountId: balance.id, debit: 0, credit: booked, memo: t.partner },
            ]
          : [
              { accountId: balance.id, debit: booked, credit: 0, memo: t.partner },
              { accountId: cash.id, debit: 0, credit: jpy, memo: `${t.partner} 支払い` },
            ];
      if (gain > 0) lines.push({ accountId: (await ensureAccount(tx, companyId, GAIN)).id, debit: 0, credit: gain, memo: "為替差益" });
      if (gain < 0) lines.push({ accountId: (await ensureAccount(tx, companyId, LOSS)).id, debit: -gain, credit: 0, memo: "為替差損" });
      const entry = await tx.journalEntry.create({
        data: {
          companyId,
          date,
          description: `外貨建て${t.kind === "SALE" ? "売上の入金" : "仕入の支払い"} ${t.partner} ${formatForeign(t.amountMinor, t.currency)}`,
          sourceType: "FOREIGN",
          status: "POSTED_MANUALLY",
          lines: { create: lines },
        },
      });
      const done = await tx.foreignTransaction.updateMany({ where: { id, settledAt: null }, data: { settledAt: date, settledJpy: jpy, settleJournalEntryId: entry.id } });
      if (done.count !== 1) throw new UserError("すでに入金・支払い済みです");
      return { gain, jpy, booked };
    });
  } catch (error) {
    throw toBooksClosedError(error) ?? error;
  }
}

// 入金・支払いを取り消す(その仕訳を取消にする)
export async function unsettleForeignTransaction(companyId: string, id: string) {
  const t = await find(companyId, id);
  if (!t.settledAt) throw new UserError("まだ入金・支払いしていません");
  try {
    await prisma.$transaction([
      ...(t.settleJournalEntryId ? [prisma.journalEntry.update({ where: { id: t.settleJournalEntryId }, data: { status: "VOID" } })] : []),
      prisma.foreignTransaction.update({ where: { id }, data: { settledAt: null, settledJpy: null, settleJournalEntryId: null } }),
    ]);
  } catch (error) {
    throw toBooksClosedError(error) ?? error;
  }
}

// 取引を取り消す(入金・支払い前だけ。計上の仕訳を取消にする)
export async function deleteForeignTransaction(companyId: string, id: string) {
  const t = await find(companyId, id);
  if (t.settledAt) throw new UserError("入金・支払い済みの取引は取り消せません。先に入金・支払いを取り消してください");
  try {
    await prisma.$transaction([
      ...(t.journalEntryId ? [prisma.journalEntry.update({ where: { id: t.journalEntryId }, data: { status: "VOID" } })] : []),
      prisma.foreignTransaction.delete({ where: { id } }),
    ]);
  } catch (error) {
    throw toBooksClosedError(error) ?? error;
  }
  return t;
}

export async function listForeignTransactions(companyId: string) {
  await ensureChartOfAccounts(companyId);
  const [rows, accounts, cashCodes] = await Promise.all([
    prisma.foreignTransaction.findMany({ where: { companyId }, orderBy: [{ settledAt: { sort: "desc", nulls: "first" } }, { date: "desc" }], take: 300 }),
    prisma.account.findMany({ where: { companyId, category: { in: ["REVENUE", "EXPENSE", "ASSET"] }, hidden: false }, orderBy: { code: "asc" }, select: { code: true, name: true, category: true } }),
    cashAccountCodes(companyId),
  ]);
  const nameOf = new Map(accounts.map((a) => [a.code, a.name]));
  const today = jstDateKey(new Date());
  const items = rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    partner: r.partner,
    description: r.description,
    currency: r.currency,
    amount: formatForeign(r.amountMinor, r.currency),
    amountMinor: r.amountMinor.toString(),
    rate: Number(r.rate),
    jpyAmount: r.jpyAmount,
    accountCode: r.accountCode,
    accountName: nameOf.get(r.accountCode) ?? r.accountCode,
    date: jstDateKey(r.date),
    dueDate: r.dueDate ? jstDateKey(r.dueDate) : null,
    overdue: !r.settledAt && !!r.dueDate && jstDateKey(r.dueDate) < today,
    settledAt: r.settledAt ? jstDateKey(r.settledAt) : null,
    settledJpy: r.settledJpy,
    gain: r.settledJpy == null ? null : r.kind === "SALE" ? r.settledJpy - r.jpyAmount : r.jpyAmount - r.settledJpy,
  }));
  // 通貨ごとの未決済の残高(外貨と、計上したときの円)
  const open = new Map<string, { currency: string; kind: string; minor: bigint; jpy: number }>();
  for (const r of rows.filter((r) => !r.settledAt)) {
    const key = `${r.kind}|${r.currency}`;
    const o = open.get(key) ?? { currency: r.currency, kind: r.kind, minor: BigInt(0), jpy: 0 };
    o.minor += r.amountMinor;
    o.jpy += r.jpyAmount;
    open.set(key, o);
  }
  const cashAccounts = await prisma.account.findMany({ where: { companyId, code: { in: cashCodes } }, select: { code: true, name: true }, orderBy: { code: "asc" } });
  return {
    items,
    open: [...open.values()].map((o) => ({ ...o, minor: o.minor.toString(), amount: formatForeign(o.minor, o.currency), digits: CURRENCIES[o.currency]?.digits ?? 2 })),
    realized: items.reduce((s, i) => s + (i.gain ?? 0), 0),
    currencies: Object.entries(CURRENCIES).map(([code, c]) => ({ code, ...c })),
    revenueAccounts: accounts.filter((a) => a.category === "REVENUE" && a.code !== GAIN),
    expenseAccounts: accounts.filter((a) => (a.category === "EXPENSE" && a.code !== LOSS) || a.code === "1310"),
    cashAccounts,
  };
}

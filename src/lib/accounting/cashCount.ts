import { prisma } from "@/lib/prisma";
import { UserError, toBooksClosedError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { ensureAccount, ensureChartOfAccounts } from "@/lib/accounting/accounts";
import { getAccountBalances } from "@/lib/accounting/ledger";
import { nextDay } from "./period";

// 現金の実査(金種表): レジ・金庫のお札と硬貨の枚数から実際の現金を出し、帳簿の「現金」の残高と比べる。
// 差があるときは、多ければ雑収入、足りなければ雑損失の仕訳で帳簿を実際に合わせる。

export const DENOMINATIONS = [10000, 5000, 2000, 1000, 500, 100, 50, 10, 5, 1] as const;
const CASH = "1010";
const OVER = "4020"; // 雑収入
const SHORT = "5190"; // 雑損失
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// その日の終わりの帳簿の現金残高
export async function bookCash(companyId: string, date: string) {
  const balances = await getAccountBalances(companyId, { lt: nextDay(date) });
  return balances.find((b) => b.account.code === CASH)?.balance ?? 0;
}

function parseCounts(input: unknown) {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const counts: Record<string, number> = {};
  let total = 0;
  for (const d of DENOMINATIONS) {
    const v = raw[String(d)];
    if (v === undefined || v === null || v === "") continue;
    const n = Number(String(v).normalize("NFKC").replace(/[,\s枚]/g, ""));
    if (!Number.isInteger(n) || n < 0 || n > 1_000_000) throw new UserError(`${d.toLocaleString()}円の枚数を0以上の整数で入力してください`);
    if (n) counts[String(d)] = n;
    total += d * n;
  }
  return { counts, total };
}

export async function recordCashCount(companyId: string, user: { name: string }, input: { date?: unknown; counts?: unknown; note?: unknown; adjust?: unknown }) {
  const date = String(input.date ?? "");
  if (!DATE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) throw new UserError("数えた日を正しく入力してください");
  if (date > jstDateKey(new Date())) throw new UserError("数えた日に、これから先の日は選べません");
  const { counts, total } = parseCounts(input.counts);
  await ensureChartOfAccounts(companyId);
  const book = await bookCash(companyId, date);
  const diff = total - book;
  const note = String(input.note ?? "").trim().slice(0, 200) || null;
  const adjust = input.adjust === true || input.adjust === "true";
  try {
    return await prisma.$transaction(async (tx) => {
      let journalEntryId: string | null = null;
      if (adjust && diff !== 0) {
        const [cash, other] = await Promise.all([ensureAccount(tx, companyId, CASH), ensureAccount(tx, companyId, diff > 0 ? OVER : SHORT)]);
        const amount = Math.abs(diff);
        const entry = await tx.journalEntry.create({
          data: {
            companyId,
            date: new Date(`${date}T00:00:00Z`),
            description: `現金の実査: ${diff > 0 ? "現金が多い" : "現金が足りない"}(帳簿 ${book.toLocaleString()}円・実際 ${total.toLocaleString()}円)${note ? ` ${note}` : ""}`.slice(0, 300),
            sourceType: "CASH_COUNT",
            status: "POSTED_MANUALLY",
            lines: {
              create:
                diff > 0
                  ? [
                      { accountId: cash.id, debit: amount, credit: 0, memo: "現金過剰" },
                      { accountId: other.id, debit: 0, credit: amount, memo: "現金過剰" },
                    ]
                  : [
                      { accountId: other.id, debit: amount, credit: 0, memo: "現金不足" },
                      { accountId: cash.id, debit: 0, credit: amount, memo: "現金不足" },
                    ],
            },
          },
        });
        journalEntryId = entry.id;
      }
      return tx.cashCount.create({ data: { companyId, date: new Date(`${date}T00:00:00Z`), counts, counted: total, book, diff, note, countedByName: user.name, journalEntryId } });
    });
  } catch (error) {
    throw toBooksClosedError(error) ?? error;
  }
}

export async function listCashCounts(companyId: string) {
  const today = jstDateKey(new Date());
  const [rows, book] = await Promise.all([prisma.cashCount.findMany({ where: { companyId }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 60 }), bookCash(companyId, today)]);
  return {
    today,
    book,
    denominations: DENOMINATIONS,
    counts: rows.map((r) => ({
      id: r.id,
      date: jstDateKey(r.date),
      counts: r.counts as Record<string, number>,
      counted: r.counted,
      book: r.book,
      diff: r.diff,
      note: r.note,
      countedByName: r.countedByName,
      adjusted: !!r.journalEntryId,
    })),
  };
}

// 記録を消す(合わせた仕訳があれば取消にする)
export async function deleteCashCount(companyId: string, id: string) {
  const row = await prisma.cashCount.findFirst({ where: { id, companyId } });
  if (!row) throw new UserError("記録が見つかりません");
  try {
    await prisma.$transaction([
      ...(row.journalEntryId ? [prisma.journalEntry.update({ where: { id: row.journalEntryId }, data: { status: "VOID" } })] : []),
      prisma.cashCount.delete({ where: { id } }),
    ]);
  } catch (error) {
    throw toBooksClosedError(error) ?? error;
  }
  return row;
}

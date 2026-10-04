import { prisma } from "@/lib/prisma";
import { UserError, toBooksClosedError } from "@/lib/errors";
import { ensureAccount, ensureChartOfAccounts } from "@/lib/accounting/accounts";
import { parseCsv } from "@/lib/csvParse";
import { fiscalYearOf, getFiscalStartMonth } from "./period";
import { jstDateKey } from "@/lib/jst";

// 開始残高: ほかの会計ソフトから乗り換えるときに、使い始める日の前日時点の残高(貸借対照表の科目)を入れる。
// 「前期繰越」の仕訳を1件だけ作る(入れ直すと、前の仕訳は取消にして作り直す)。
// 使い始める日の前日の日付にするので、使い始めてからの損益・キャッシュ・フロー計算書には入らない。

const RETAINED = "3020"; // 繰越利益剰余金(差額の受け皿)
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const BS = ["ASSET", "LIABILITY", "EQUITY"] as const;

const dayBefore = (key: string) => new Date(Date.parse(`${key}T00:00:00Z`) - 86_400_000);
const dayAfter = (d: Date) => new Date(d.getTime() + 86_400_000).toISOString().slice(0, 10);

async function current(companyId: string) {
  return prisma.journalEntry.findFirst({
    where: { companyId, sourceType: "OPENING", status: { not: "VOID" } },
    include: { lines: { include: { account: { select: { code: true, category: true } } } } },
    orderBy: { createdAt: "desc" },
  });
}

// 借方・貸方を、その科目のふつうの向き(資産は借方、負債・純資産は貸方)のプラスの金額にする
const signed = (category: string, debit: number, credit: number) => (category === "ASSET" ? debit - credit : credit - debit);

export async function getOpeningBalances(companyId: string) {
  await ensureChartOfAccounts(companyId);
  const [accounts, entry, startMonth] = await Promise.all([
    prisma.account.findMany({ where: { companyId, category: { in: [...BS] } }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true, category: true, hidden: true } }),
    current(companyId),
    getFiscalStartMonth(companyId),
  ]);
  const amounts: Record<string, number> = {};
  for (const l of entry?.lines ?? []) amounts[l.account.code] = (amounts[l.account.code] ?? 0) + signed(l.account.category, l.debit, l.credit);
  return {
    accounts: accounts.filter((a) => !a.hidden || amounts[a.code]),
    amounts,
    // 入れてある開始残高の「使い始めた日」(仕訳の日付の次の日)。まだなら今期の初日
    startDate: entry ? dayAfter(entry.date) : fiscalYearOf(jstDateKey(new Date()), startMonth).from,
    savedAt: entry?.createdAt ?? null,
    entryId: entry?.id ?? null,
  };
}

type SaveInput = { startDate?: unknown; amounts?: unknown; balanceToRetained?: unknown };

export async function saveOpeningBalances(companyId: string, input: SaveInput) {
  const startDate = String(input.startDate ?? "");
  if (!DATE.test(startDate) || Number.isNaN(Date.parse(`${startDate}T00:00:00Z`))) throw new UserError("使い始める日を正しく入力してください");
  const raw = (input.amounts && typeof input.amounts === "object" ? input.amounts : {}) as Record<string, unknown>;
  const accounts = await prisma.account.findMany({ where: { companyId, category: { in: [...BS] } }, select: { id: true, code: true, name: true, category: true } });
  const byCode = new Map(accounts.map((a) => [a.code, a]));

  const lines: { accountId: string; debit: number; credit: number; memo: string }[] = [];
  let debit = 0;
  let credit = 0;
  for (const [code, value] of Object.entries(raw)) {
    if (value === "" || value === null || value === undefined) continue;
    const amount = Number(String(value).normalize("NFKC").replace(/[,¥円\s]/g, ""));
    const account = byCode.get(code);
    if (!account) throw new UserError(`科目コード ${code} が見つかりません`);
    if (!Number.isInteger(amount) || Math.abs(amount) > 1e12) throw new UserError(`「${account.name}」の金額を整数で入力してください`);
    if (amount === 0) continue;
    // ふつうの向きのプラス → 資産は借方、負債・純資産は貸方(マイナスなら逆)
    const onDebit = account.category === "ASSET" ? amount > 0 : amount < 0;
    const v = Math.abs(amount);
    lines.push({ accountId: account.id, debit: onDebit ? v : 0, credit: onDebit ? 0 : v, memo: "前期繰越" });
    if (onDebit) debit += v;
    else credit += v;
  }
  if (!lines.length) throw new UserError("残高を1つ以上入力してください");

  // 借方と貸方の差は、繰越利益剰余金で合わせる(合わせないときは、ぴったり合っている必要がある)
  const diff = debit - credit;
  if (diff !== 0) {
    if (input.balanceToRetained !== true && input.balanceToRetained !== "true") {
      throw new UserError(`資産の合計と、負債・純資産の合計が ${Math.abs(diff).toLocaleString()}円 合いません。差額を繰越利益剰余金にするか、金額を見直してください`);
    }
  }

  const date = dayBefore(startDate);
  try {
    return await prisma.$transaction(async (tx) => {
      if (diff !== 0) {
        const retained = await ensureAccount(tx, companyId, RETAINED);
        const existing = lines.find((l) => l.accountId === retained.id);
        // 繰越利益剰余金を入れてあれば、その行で合わせる
        if (existing) {
          const net = existing.credit - existing.debit + diff;
          existing.debit = net < 0 ? -net : 0;
          existing.credit = net > 0 ? net : 0;
          existing.memo = "前期繰越(差額を含む)";
        } else lines.push({ accountId: retained.id, debit: diff < 0 ? -diff : 0, credit: diff > 0 ? diff : 0, memo: "前期繰越(差額)" });
      }
      const old = await tx.journalEntry.findMany({ where: { companyId, sourceType: "OPENING", status: { not: "VOID" } }, select: { id: true } });
      if (old.length) await tx.journalEntry.updateMany({ where: { id: { in: old.map((o) => o.id) } }, data: { status: "VOID" } });
      return tx.journalEntry.create({
        data: {
          companyId,
          date,
          description: "開始残高(前期繰越)",
          sourceType: "OPENING",
          status: "POSTED_MANUALLY",
          createdByAi: false,
          lines: { create: lines.filter((l) => l.debit || l.credit) },
        },
      });
    });
  } catch (error) {
    throw toBooksClosedError(error) ?? error;
  }
}

// 開始残高を消す(仕訳を取消にする)
export async function clearOpeningBalances(companyId: string) {
  try {
    const r = await prisma.journalEntry.updateMany({ where: { companyId, sourceType: "OPENING", status: { not: "VOID" } }, data: { status: "VOID" } });
    if (!r.count) throw new UserError("開始残高はまだ入っていません");
  } catch (error) {
    throw toBooksClosedError(error) ?? error;
  }
}

// ほかの会計ソフトの残高試算表・貸借対照表の CSV から金額を読む。
// 科目名(または科目コード)の列と、残高の列を探す。名前は「普通預金(〇〇銀行)」のような補助も含めて照らし合わせる。
export async function readBalanceCsv(companyId: string, text: string) {
  const rows = parseCsv(text).filter((r) => r.some((c) => c.trim()));
  if (rows.length < 2) throw new UserError("CSV に行がありません");
  const header = rows[0].map((h) => h.normalize("NFKC").replace(/\s/g, ""));
  const find = (...names: string[]) => header.findIndex((h) => names.some((n) => h === n || h.includes(n)));
  const nameCol = find("勘定科目", "科目名", "科目");
  const codeCol = find("科目コード", "コード");
  // 「期末残高」「残高」「金額」の順に探す(期首残高・前月残高は使わない)
  let amountCol = header.findIndex((h) => h.includes("期末残高") || h === "当期末残高");
  if (amountCol < 0) amountCol = header.findIndex((h) => (h.includes("残高") && !h.includes("期首") && !h.includes("前月") && !h.includes("前期")) || h === "金額");
  if (amountCol < 0 || (nameCol < 0 && codeCol < 0)) throw new UserError("「勘定科目(または科目コード)」と「残高(または金額)」の列が見つかりません");

  const accounts = await prisma.account.findMany({ where: { companyId }, select: { code: true, name: true, category: true } });
  const norm = (s: string) => s.normalize("NFKC").replace(/\s/g, "");
  const amounts: Record<string, number> = {};
  const unmatched: { name: string; amount: number }[] = [];
  // 損益の科目(売上・費用)は開始残高には入れない(使い始める日を期首にすると0になる)
  const profitLoss: { name: string; amount: number }[] = [];
  for (const r of rows.slice(1)) {
    const name = nameCol >= 0 ? norm(r[nameCol] ?? "") : "";
    const code = codeCol >= 0 ? norm(r[codeCol] ?? "") : "";
    const amount = Number(norm(r[amountCol] ?? "").replace(/[,¥円]/g, "").replace(/^△/, "-").replace(/^\((.*)\)$/, "-$1"));
    if (!Number.isFinite(amount) || amount === 0 || /合計|計$/.test(name)) continue;
    const account = accounts.find((a) => a.code === code) ?? accounts.find((a) => norm(a.name) === name) ?? accounts.find((a) => name && norm(a.name).startsWith(name));
    if (!account) {
      if (name || code) unmatched.push({ name: name || code, amount: Math.round(amount) });
      continue;
    }
    if (account.category === "REVENUE" || account.category === "EXPENSE") {
      profitLoss.push({ name: account.name, amount: Math.round(amount) });
      continue;
    }
    // 減価償却累計額は、資産のマイナス(△)で書かれていても、残高として扱う
    const value = account.code === "1519" ? Math.abs(Math.round(amount)) : Math.round(amount);
    amounts[account.code] = (amounts[account.code] ?? 0) + value;
  }
  return { amounts, unmatched, profitLoss };
}

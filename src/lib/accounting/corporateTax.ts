import { prisma } from "@/lib/prisma";
import { UserError, toBooksClosedError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { ensureAccount, ensureChartOfAccounts } from "@/lib/accounting/accounts";
import { getAccountBalances } from "@/lib/accounting/ledger";
import { fiscalYearOf, getFiscalStartMonth, nextDay } from "./period";
import { calcCorporateTax, DEFAULT_TAX_INPUT, type CorporateTaxInput } from "./corporateTaxCalc";

// 法人税等の計算と計上。年度の税引前当期純利益から法人税・地方法人税・住民税・事業税・特別法人事業税の目安を出し、
// 期末の日付で「法人税等 / 仮払法人税等(中間納付)・未払法人税等」の仕訳を作る。

export const INCOME_TAX = "5900"; // 法人税等
const PREPAID = "1240"; // 仮払法人税等(中間納付)
const REFUND = "1245"; // 未収還付法人税等
const PAYABLE = "2140"; // 未払法人税等
const ENTERTAINMENT = "5050"; // 接待交際費
const CAPITAL = "3010"; // 資本金

const yen = (v: unknown, label: string, max = 10_000_000_000) => {
  const n = Number(String(v ?? "0").normalize("NFKC").replace(/[,¥円\s]/g, "") || "0");
  if (!Number.isInteger(n) || n < 0 || n > max) throw new UserError(`${label}は0以上の整数(円)で入力してください`);
  return n;
};

export function parseTaxInput(raw: unknown): CorporateTaxInput {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const months = Number(r.months ?? 12);
  if (!Number.isInteger(months) || months < 1 || months > 12) throw new UserError("事業年度の月数は1〜12で入力してください");
  return {
    addBack: yen(r.addBack, "加算する金額"),
    deduction: yen(r.deduction, "減算する金額"),
    lossCarryforward: yen(r.lossCarryforward, "繰越欠損金"),
    perCapita: yen(r.perCapita ?? DEFAULT_TAX_INPUT.perCapita, "均等割", 10_000_000),
    months,
  };
}

async function fiscalYear(companyId: string, year?: number) {
  const startMonth = await getFiscalStartMonth(companyId);
  const today = jstDateKey(new Date());
  const current = fiscalYearOf(today, startMonth);
  const y = year && Number.isInteger(year) && year > 1900 && year < 3000 ? year : current.year;
  const fy = fiscalYearOf(`${y}-${String(startMonth).padStart(2, "0")}-01`, startMonth);
  // 期末の月に入ったら計上できる
  const lastMonth = `${fy.to.slice(0, 7)}-01`;
  return { ...fy, year: y, currentYear: current.year, inProgress: fy.to >= today, canPost: today >= lastMonth };
}

// 計上した仕訳を除いた、年度の数字(税引前当期純利益・交際費・資本金・中間納付)
async function taxBase(companyId: string, fy: { from: string; to: string }, ownEntryId: string | null) {
  const [period, closing, own] = await Promise.all([
    getAccountBalances(companyId, { gte: new Date(`${fy.from}T00:00:00Z`), lt: nextDay(fy.to) }),
    getAccountBalances(companyId, { lt: nextDay(fy.to) }),
    ownEntryId
      ? prisma.journalLine.findMany({ where: { journalEntryId: ownEntryId, journalEntry: { status: { not: "VOID" } }, account: { code: PREPAID } }, select: { credit: true, debit: true } })
      : Promise.resolve([]),
  ]);
  const sumOf = (cat: string) => period.filter((b) => b.account.category === cat && b.account.code !== INCOME_TAX).reduce((s, b) => s + b.balance, 0);
  const revenue = sumOf("REVENUE");
  const expense = sumOf("EXPENSE");
  const at = (list: typeof period, code: string) => list.find((b) => b.account.code === code)?.balance ?? 0;
  return {
    revenue,
    expense,
    pretax: revenue - expense,
    entertainment: at(period, ENTERTAINMENT),
    capital: at(closing, CAPITAL),
    // 中間納付: 期末の仮払法人税等の残高(この計算の仕訳で取り崩した分は戻して数える)
    interim: at(closing, PREPAID) + own.reduce((s, l) => s + l.credit - l.debit, 0),
    // 期中に法人税等へ直接記帳した分(この計算の仕訳以外)
    booked: at(period, INCOME_TAX),
  };
}

export async function getCorporateTax(companyId: string, year?: number, override?: CorporateTaxInput) {
  const fy = await fiscalYear(companyId, year);
  const run = await prisma.corporateTaxRun.findUnique({ where: { companyId_fiscalYear: { companyId, fiscalYear: fy.year } } });
  const ownEntry = run?.journalEntryId ? await prisma.journalEntry.findFirst({ where: { id: run.journalEntryId, status: { not: "VOID" } }, select: { id: true } }) : null;
  const base = await taxBase(companyId, fy, ownEntry?.id ?? null);
  const input = override ?? (run ? parseTaxInput(run.input) : DEFAULT_TAX_INPUT);
  const posted = ownEntry && run?.postedAt ? { at: jstDateKey(run.postedAt), by: run.postedByName, total: (run.result as { total?: number }).total ?? 0 } : null;
  // 期中に法人税等へ直接入れた分は、計上した仕訳の分を除いて見せる
  const bookedOther = base.booked - (posted?.total ?? 0);
  return {
    fiscalYear: fy.year,
    currentYear: fy.currentYear,
    from: fy.from,
    to: fy.to,
    inProgress: fy.inProgress,
    canPost: fy.canPost,
    base: { revenue: base.revenue, expense: base.expense, pretax: base.pretax, entertainment: base.entertainment, capital: base.capital, interim: base.interim, bookedOther },
    input,
    result: calcCorporateTax(base, input),
    posted,
  };
}

// 入力を保存する(post なら期末の日付で仕訳も作る。前に計上した仕訳は取消にして作り直す)
export async function saveCorporateTax(companyId: string, user: { name: string }, year: number | undefined, rawInput: unknown, post: boolean) {
  const input = parseTaxInput(rawInput);
  const state = await getCorporateTax(companyId, year, input);
  const { result, base } = state;
  if (post && !state.canPost) throw new UserError(`${state.to.slice(0, 7).replace("-", "年")}月(期末の月)になったら計上できます`);
  if (post && base.bookedOther !== 0) throw new UserError("この年度は、法人税等の科目にほかの仕訳がすでに入っています。重なって計上しないよう、その仕訳を確認してください");
  if (post && result.total === 0 && base.interim === 0) throw new UserError("計上する税額がありません");
  await ensureChartOfAccounts(companyId);
  const existing = await prisma.corporateTaxRun.findUnique({ where: { companyId_fiscalYear: { companyId, fiscalYear: state.fiscalYear } } });
  try {
    return await prisma.$transaction(async (tx) => {
      let journalEntryId = existing?.journalEntryId ?? null;
      if (post) {
        if (journalEntryId) await tx.journalEntry.updateMany({ where: { id: journalEntryId, companyId }, data: { status: "VOID" } });
        const diff = result.total - base.interim;
        const [tax, prepaid, other] = await Promise.all([
          ensureAccount(tx, companyId, INCOME_TAX),
          ensureAccount(tx, companyId, PREPAID),
          ensureAccount(tx, companyId, diff >= 0 ? PAYABLE : REFUND),
        ]);
        const memo = `${state.fiscalYear}年度 法人税等`;
        const lines = [
          ...(result.total > 0 ? [{ accountId: tax.id, debit: result.total, credit: 0, memo }] : []),
          ...(diff < 0 ? [{ accountId: other.id, debit: -diff, credit: 0, memo: "中間納付の還付見込み" }] : []),
          ...(base.interim > 0 ? [{ accountId: prepaid.id, debit: 0, credit: base.interim, memo: "中間納付の取り崩し" }] : []),
          ...(diff > 0 ? [{ accountId: other.id, debit: 0, credit: diff, memo: "確定申告で納める分" }] : []),
        ];
        const entry = await tx.journalEntry.create({
          data: {
            companyId,
            date: new Date(`${state.to}T00:00:00Z`),
            description: `${state.fiscalYear}年度の法人税等(法人税・地方法人税・住民税・事業税・特別法人事業税)`,
            sourceType: "CORPORATE_TAX",
            status: "POSTED_MANUALLY",
            lines: { create: lines },
          },
        });
        journalEntryId = entry.id;
      }
      const data = {
        input,
        result,
        journalEntryId,
        ...(post ? { postedByName: user.name, postedAt: new Date() } : {}),
      };
      await tx.corporateTaxRun.upsert({
        where: { companyId_fiscalYear: { companyId, fiscalYear: state.fiscalYear } },
        create: { companyId, fiscalYear: state.fiscalYear, ...data },
        update: data,
      });
      return { fiscalYear: state.fiscalYear, total: result.total, interim: base.interim, payable: result.total - base.interim, posted: post };
    });
  } catch (error) {
    throw toBooksClosedError(error) ?? error;
  }
}

// 計上を取り消す(仕訳を取消にする。入力は残す)
export async function cancelCorporateTax(companyId: string, year: number) {
  const run = await prisma.corporateTaxRun.findUnique({ where: { companyId_fiscalYear: { companyId, fiscalYear: year } } });
  if (!run?.journalEntryId) throw new UserError("この年度はまだ計上していません");
  try {
    await prisma.$transaction([
      prisma.journalEntry.updateMany({ where: { id: run.journalEntryId, companyId }, data: { status: "VOID" } }),
      prisma.corporateTaxRun.update({ where: { id: run.id }, data: { journalEntryId: null, postedAt: null, postedByName: null } }),
    ]);
  } catch (error) {
    throw toBooksClosedError(error) ?? error;
  }
  return run;
}

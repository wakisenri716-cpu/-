import { prisma } from "@/lib/prisma";
import { UserError, toBooksClosedError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { ensureAccount, ensureChartOfAccounts } from "@/lib/accounting/accounts";
import { getAccountBalances } from "@/lib/accounting/ledger";
import { BUSINESS_TYPES, TAX_METHODS, estimateByMethod, getConsumptionTax, isTaxMethod, type TaxMethod } from "./consumptionTax";
import { getTransitionalAdjustment } from "./invoiceRegistration";
import { fiscalYearOf, getFiscalStartMonth, nextDay } from "./period";

// 消費税の決算整理。年度の仮受消費税・仮払消費税を相殺し、納める消費税(国税 7.8% 分 + 地方消費税)を未払消費税等にする。
// 簡易課税・2割特例や端数で「仮受 − 仮払」と納める額が違う分は、雑収入(多く預かった)か雑損失にする。
// あわせて、今年度の消費税額(国税)から翌年度の中間申告の回数と金額の目安を出す。

const OUTPUT_TAX = "2110"; // 仮受消費税
const INPUT_TAX = "1220"; // 仮払消費税
const INTERIM = "1250"; // 中間納付消費税
const RECEIVABLE = "1255"; // 未収消費税等
const PAYABLE = "2150"; // 未払消費税等
const GAIN = "4020"; // 雑収入
const LOSS = "5190"; // 雑損失

const floor100 = (n: number) => Math.floor(n / 100) * 100;

// 納める消費税を国税(消費税)と地方消費税に分ける: 地方消費税 = 国税 × 22/78。マイナス(還付)は切り捨てずにそのまま分ける
export function splitTax(total: number) {
  if (total <= 0) {
    const national = Math.ceil((total * 78) / 100);
    return { national, local: total - national, total };
  }
  const national = floor100((total * 78) / 100);
  const local = floor100((national * 22) / 78);
  return { national, local, total: national + local };
}

// 翌年度の中間申告: 今年度の消費税額(国税)で回数が決まる
export function interimPlan(national: number) {
  const count = national > 48_000_000 ? 11 : national > 4_000_000 ? 3 : national > 480_000 ? 1 : 0;
  if (count === 0) return { count, national: 0, local: 0, each: 0, note: "今年度の消費税額(国税)が48万円以下なので、翌年度の中間申告はありません(任意で6か月の中間申告をすることはできます)" };
  const months = count === 1 ? 6 : count === 3 ? 3 : 1;
  const n = floor100((national * months) / 12);
  const l = floor100((n * 22) / 78);
  return {
    count,
    national: n,
    local: l,
    each: n + l,
    note: count === 1 ? "年1回(年度の最初の6か月の後)" : count === 3 ? "年3回(3か月ごと)" : "年11回(毎月)",
  };
}

async function fiscalYear(companyId: string, year?: number) {
  const startMonth = await getFiscalStartMonth(companyId);
  const today = jstDateKey(new Date());
  const current = fiscalYearOf(today, startMonth);
  const y = year && Number.isInteger(year) && year > 1900 && year < 3000 ? year : current.year;
  const fy = fiscalYearOf(`${y}-${String(startMonth).padStart(2, "0")}-01`, startMonth);
  return { ...fy, year: y, startMonth, currentYear: current.year, inProgress: fy.to >= today, canPost: today >= `${fy.to.slice(0, 7)}-01` };
}

// 決算整理の仕訳を除いた中間納付の残高(計上した仕訳で取り崩した分を戻す)
async function interimPaid(companyId: string, to: string, ownEntryId: string | null) {
  const [closing, own] = await Promise.all([
    getAccountBalances(companyId, { lt: nextDay(to) }),
    ownEntryId
      ? prisma.journalLine.findMany({ where: { journalEntryId: ownEntryId, journalEntry: { status: { not: "VOID" } }, account: { code: INTERIM } }, select: { debit: true, credit: true } })
      : Promise.resolve([]),
  ]);
  const balance = closing.find((b) => b.account.code === INTERIM)?.balance ?? 0;
  return balance + own.reduce((s, l) => s + l.credit - l.debit, 0);
}

export async function getConsumptionTaxClose(companyId: string, year?: number) {
  const fy = await fiscalYear(companyId, year);
  const range = { gte: new Date(`${fy.from}T00:00:00Z`), lt: nextDay(fy.to) };
  const [tax, transitional, company, saved] = await Promise.all([
    getConsumptionTax(companyId, range),
    getTransitionalAdjustment(companyId, range),
    prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { consumptionTaxMethod: true, simplifiedBusinessType: true } }),
    prisma.consumptionTaxClose.findUnique({ where: { companyId_fiscalYear: { companyId, fiscalYear: fy.year } } }),
  ]);
  const ownEntry = saved ? await prisma.journalEntry.findFirst({ where: { id: saved.journalEntryId, status: { not: "VOID" } }, select: { id: true } }) : null;
  const method: TaxMethod = isTaxMethod(company.consumptionTaxMethod) ? company.consumptionTaxMethod : "GENERAL";
  const businessType = BUSINESS_TYPES[company.simplifiedBusinessType] ? company.simplifiedBusinessType : 5;
  const due = estimateByMethod(tax.outputTotal, tax.inputTotal, businessType, transitional.notDeductible)[method];
  const split = splitTax(due);
  const interim = await interimPaid(companyId, fy.to, ownEntry?.id ?? null);
  // 仮受 − 仮払 と 納める額 の差(プラスは雑収入、マイナスは雑損失)
  const difference = tax.outputTotal - tax.inputTotal - split.total;
  return {
    fiscalYear: fy.year,
    currentYear: fy.currentYear,
    from: fy.from,
    to: fy.to,
    inProgress: fy.inProgress,
    canPost: fy.canPost,
    method,
    methodLabel: TAX_METHODS[method],
    businessType: method === "SIMPLIFIED" ? `${BUSINESS_TYPES[businessType].label}(${BUSINESS_TYPES[businessType].example})` : null,
    output: tax.outputTotal,
    input: tax.inputTotal,
    notDeductible: method === "GENERAL" ? transitional.notDeductible : 0,
    national: split.national,
    local: split.local,
    total: split.total,
    interim,
    payable: split.total - interim, // マイナスは還付
    difference,
    nextInterim: interimPlan(split.national),
    posted: ownEntry && saved ? { at: jstDateKey(saved.createdAt), by: saved.postedByName, total: (saved.result as { total?: number }).total ?? 0 } : null,
  };
}

export async function postConsumptionTaxClose(companyId: string, user: { name: string }, year?: number) {
  const s = await getConsumptionTaxClose(companyId, year);
  if (!s.canPost) throw new UserError(`${Number(s.to.slice(5, 7))}月(期末の月)になったら計上できます`);
  if (s.output === 0 && s.input === 0 && s.interim === 0) throw new UserError("この年度は仮受消費税・仮払消費税がありません");
  await ensureChartOfAccounts(companyId);
  const existing = await prisma.consumptionTaxClose.findUnique({ where: { companyId_fiscalYear: { companyId, fiscalYear: s.fiscalYear } } });
  try {
    return await prisma.$transaction(async (tx) => {
      if (existing) await tx.journalEntry.updateMany({ where: { id: existing.journalEntryId, companyId }, data: { status: "VOID" } });
      const acc = async (code: string) => (await ensureAccount(tx, companyId, code)).id;
      const memo = `${s.fiscalYear}年度 消費税`;
      const lines: { accountId: string; debit: number; credit: number; memo: string }[] = [];
      const add = async (code: string, amount: number, debitSide: boolean, m: string) => {
        if (amount === 0) return;
        const positive = amount > 0 === debitSide;
        lines.push({ accountId: await acc(code), debit: positive ? Math.abs(amount) : 0, credit: positive ? 0 : Math.abs(amount), memo: m });
      };
      await add(OUTPUT_TAX, s.output, true, `${memo}(仮受消費税の振替)`);
      await add(INPUT_TAX, s.input, false, `${memo}(仮払消費税の振替)`);
      await add(INTERIM, s.interim, false, `${memo}(中間納付の取り崩し)`);
      if (s.payable >= 0) await add(PAYABLE, s.payable, false, `${memo}(確定申告で納める分)`);
      else await add(RECEIVABLE, -s.payable, true, `${memo}(還付される分)`);
      if (s.difference > 0) await add(GAIN, s.difference, false, `${memo}(${s.methodLabel}・端数の差額)`);
      else if (s.difference < 0) await add(LOSS, -s.difference, true, `${memo}(控除できない消費税・端数の差額)`);
      const entry = await tx.journalEntry.create({
        data: {
          companyId,
          date: new Date(`${s.to}T00:00:00Z`),
          description: `${s.fiscalYear}年度の消費税の決算整理(${s.methodLabel}・納付 ${s.total.toLocaleString()}円)`,
          sourceType: "CONSUMPTION_TAX",
          status: "POSTED_MANUALLY",
          lines: { create: lines },
        },
      });
      const result = { output: s.output, input: s.input, national: s.national, local: s.local, total: s.total, interim: s.interim, payable: s.payable, difference: s.difference, method: s.method };
      await tx.consumptionTaxClose.upsert({
        where: { companyId_fiscalYear: { companyId, fiscalYear: s.fiscalYear } },
        create: { companyId, fiscalYear: s.fiscalYear, result, journalEntryId: entry.id, postedByName: user.name },
        update: { result, journalEntryId: entry.id, postedByName: user.name, createdAt: new Date() },
      });
      return { fiscalYear: s.fiscalYear, total: s.total, payable: s.payable, difference: s.difference };
    });
  } catch (error) {
    throw toBooksClosedError(error) ?? error;
  }
}

export async function cancelConsumptionTaxClose(companyId: string, year: number) {
  const saved = await prisma.consumptionTaxClose.findUnique({ where: { companyId_fiscalYear: { companyId, fiscalYear: year } } });
  if (!saved) throw new UserError("この年度はまだ計上していません");
  try {
    await prisma.$transaction([
      prisma.journalEntry.updateMany({ where: { id: saved.journalEntryId, companyId }, data: { status: "VOID" } }),
      prisma.consumptionTaxClose.delete({ where: { id: saved.id } }),
    ]);
  } catch (error) {
    throw toBooksClosedError(error) ?? error;
  }
  return saved;
}

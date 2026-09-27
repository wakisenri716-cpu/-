import { prisma } from "@/lib/prisma";
import { toBooksClosedError, UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { ensureAccount } from "@/lib/accounting/accounts";
import type { PayrollSheetRow } from "@/lib/payroll/service";
import { bonusPayments } from "@/lib/payroll/bonus";
import {
  addMonth,
  FEE_CATEGORIES,
  feeWithholding,
  incomeTaxSpecialPeriod,
  monthlyPeriod,
  residentTaxSpecialPeriod,
  type FeeCategory,
  type Period,
} from "./rules";

// 報酬の源泉徴収・支払調書・源泉所得税と住民税の納付の管理。

const OPEN = ["CONFIRMED", "SENT", "PARTIALLY_PAID", "OVERDUE", "PAID"] as const;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function yearRange(year: number) {
  return { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) };
}

function checkYear(value: unknown) {
  const year = Number(value);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new UserError("年を正しく指定してください");
  return year;
}

// ---- 報酬の源泉徴収 ----

// その年に受け取った請求書と、記録した源泉徴収
export async function listFeeInvoices(companyId: string, yearValue: unknown) {
  const year = checkYear(yearValue);
  const invoices = await prisma.invoice.findMany({
    where: { companyId, direction: "RECEIVED", status: { in: [...OPEN] }, issueDate: yearRange(year) },
    include: { vendor: { select: { id: true, name: true } }, payments: { orderBy: { paymentDate: "asc" } } },
    orderBy: { issueDate: "asc" },
  });
  return invoices.map((i) => {
    const paid = i.payments.reduce((s, p) => s + p.amount, 0);
    const withholdings = i.payments.filter((p) => p.withholding);
    // 消費税が分かれていれば税抜の額を報酬にできる
    const base = i.taxAmount && i.subtotalAmount ? i.subtotalAmount : i.totalAmount;
    return {
      id: i.id,
      invoiceNumber: i.invoiceNumber,
      vendorId: i.vendor?.id ?? null,
      vendorName: i.vendor?.name ?? "(取引先なし)",
      issueDate: i.issueDate ? jstDateKey(i.issueDate) : null,
      total: i.totalAmount,
      subtotal: i.subtotalAmount,
      tax: i.taxAmount,
      remaining: i.totalAmount - paid,
      suggestedBase: base,
      suggestedAmount: feeWithholding(base),
      withholdings: withholdings.map((w) => ({ id: w.id, amount: w.amount, base: w.withholdingBase, category: w.feeCategory, date: jstDateKey(w.paymentDate) })),
    };
  });
}

export async function recordWithholding(companyId: string, invoiceId: string, input: { base?: unknown; amount?: unknown; category?: unknown; date?: unknown }) {
  const invoice = await prisma.invoice.findFirst({ where: { id: invoiceId, companyId, direction: "RECEIVED" }, include: { payments: true } });
  if (!invoice) throw new UserError("受け取った請求書が見つかりません");
  if (!OPEN.includes(invoice.status as (typeof OPEN)[number])) throw new UserError("確定していない・取り消した請求書には記録できません");
  if (invoice.payments.some((p) => p.withholding)) throw new UserError("この請求書にはすでに源泉徴収を記録しています。直すときは消してから入れ直してください");
  const base = Number(input.base);
  if (!Number.isInteger(base) || base <= 0) throw new UserError("報酬の額を正しく入力してください");
  const amount = input.amount === undefined || input.amount === "" ? feeWithholding(base) : Number(input.amount);
  if (!Number.isInteger(amount) || amount <= 0 || amount > base) throw new UserError("源泉徴収税額を正しく入力してください");
  const category = String(input.category ?? "") as FeeCategory;
  if (!FEE_CATEGORIES[category]) throw new UserError("報酬の種類を選んでください");
  const date = String(input.date ?? "");
  if (!DATE.test(date)) throw new UserError("支払日を正しく入力してください");
  const remaining = invoice.totalAmount - invoice.payments.reduce((s, p) => s + p.amount, 0);
  if (amount > remaining) throw new UserError(`請求書の残り(${remaining.toLocaleString("ja-JP")}円)より多くは差し引けません。源泉徴収は、支払いを記録する前に入れてください`);

  try {
    return await prisma.$transaction(async (tx) => {
      const [payable, withheld] = await Promise.all([ensureAccount(tx, companyId, "2010"), ensureAccount(tx, companyId, "2120")]);
      const entry = await tx.journalEntry.create({
        data: {
          companyId,
          date: new Date(`${date}T00:00:00Z`),
          description: `源泉徴収: ${invoice.invoiceNumber ?? "請求書"} ${FEE_CATEGORIES[category]}`,
          sourceType: "PAYMENT",
          status: "AUTO_POSTED",
          createdByAi: false,
          lines: {
            create: [
              { accountId: payable.id, debit: amount, credit: 0, memo: "報酬から差し引く源泉所得税" },
              { accountId: withheld.id, debit: 0, credit: amount, memo: "源泉所得税(報酬)の預り" },
            ],
          },
        },
      });
      const payment = await tx.payment.create({
        data: { companyId, invoiceId, amount, paymentDate: new Date(`${date}T00:00:00Z`), journalEntryId: entry.id, withholding: true, withholdingBase: base, feeCategory: category },
      });
      const paid = invoice.payments.reduce((s, p) => s + p.amount, 0) + amount;
      await tx.invoice.update({ where: { id: invoiceId }, data: { status: paid >= invoice.totalAmount ? "PAID" : "PARTIALLY_PAID" } });
      return payment;
    });
  } catch (error) {
    throw toBooksClosedError(error) ?? error;
  }
}

export async function deleteWithholding(companyId: string, paymentId: string) {
  const payment = await prisma.payment.findFirst({ where: { id: paymentId, companyId, withholding: true }, include: { invoice: { include: { payments: true } } } });
  if (!payment) throw new UserError("源泉徴収の記録が見つかりません");
  try {
    await prisma.$transaction(async (tx) => {
      await tx.payment.delete({ where: { id: paymentId } });
      if (payment.journalEntryId) await tx.journalEntry.update({ where: { id: payment.journalEntryId }, data: { status: "VOID" } });
      const paid = payment.invoice.payments.filter((p) => p.id !== paymentId).reduce((s, p) => s + p.amount, 0);
      await tx.invoice.update({ where: { id: payment.invoiceId }, data: { status: paid <= 0 ? "CONFIRMED" : paid >= payment.invoice.totalAmount ? "PAID" : "PARTIALLY_PAID" } });
    });
  } catch (error) {
    throw toBooksClosedError(error) ?? error;
  }
  return payment;
}

// ---- 支払調書・法定調書合計表 ----

// 支払った給料と賞与を、支払った月ごとに(給料は「働いた月の翌月に払う」の設定で支払月を決める)
type PaidRow = { staffId: string; name: string; gross: number; commute: number; incomeTax: number; residentTax: number };
async function payrollByPayMonth(companyId: string) {
  const [company, runs, bonuses] = await Promise.all([
    prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { salaryPaidNextMonth: true } }),
    prisma.payrollRun.findMany({ where: { companyId }, orderBy: { month: "asc" } }),
    bonusPayments(companyId),
  ]);
  return [
    ...runs.map((r) => ({
      kind: "給与",
      payMonth: company.salaryPaidNextMonth ? addMonth(r.month, 1) : r.month,
      rows: (Array.isArray(r.details) ? (r.details as unknown as PayrollSheetRow[]) : []) as PaidRow[],
    })),
    ...bonuses.map((b) => ({
      kind: "賞与",
      payMonth: b.payMonth,
      rows: b.rows.map((x) => ({ staffId: x.staffId, name: x.name, gross: x.amount, commute: 0, incomeTax: x.incomeTax, residentTax: 0 })),
    })),
  ];
}

export async function getStatements(companyId: string, yearValue: unknown) {
  const year = checkYear(yearValue);
  const [payments, payroll] = await Promise.all([
    prisma.payment.findMany({
      where: { companyId, withholding: true, paymentDate: yearRange(year) },
      include: { invoice: { select: { invoiceNumber: true, vendor: { select: { id: true, name: true, address: true } } } } },
      orderBy: { paymentDate: "asc" },
    }),
    payrollByPayMonth(companyId),
  ]);
  const byVendor = new Map<string, { vendorId: string; name: string; address: string | null; categories: Set<string>; base: number; tax: number; count: number }>();
  for (const p of payments) {
    const v = p.invoice.vendor;
    const key = v?.id ?? "none";
    const cur = byVendor.get(key) ?? { vendorId: key, name: v?.name ?? "(取引先なし)", address: v?.address ?? null, categories: new Set<string>(), base: 0, tax: 0, count: 0 };
    cur.base += p.withholdingBase ?? 0;
    cur.tax += p.amount;
    cur.count++;
    if (p.feeCategory) cur.categories.add(FEE_CATEGORIES[p.feeCategory as FeeCategory] ?? p.feeCategory);
    byVendor.set(key, cur);
  }
  const fees = [...byVendor.values()].map((v) => ({ ...v, categories: [...v.categories], mustSubmit: v.base > 50_000 }));

  const salaryPeople = new Map<string, { name: string; gross: number; incomeTax: number }>();
  for (const run of payroll.filter((r) => r.payMonth.startsWith(`${year}-`))) {
    for (const r of run.rows) {
      const cur = salaryPeople.get(r.staffId) ?? { name: r.name, gross: 0, incomeTax: 0 };
      cur.gross += r.gross - Math.min(r.commute, 150_000);
      cur.incomeTax += r.incomeTax;
      salaryPeople.set(r.staffId, cur);
    }
  }
  const salaries = [...salaryPeople.values()];
  return {
    year,
    fees,
    salaries,
    summary: {
      salary: { people: salaries.length, amount: salaries.reduce((s, x) => s + x.gross, 0), tax: salaries.reduce((s, x) => s + x.incomeTax, 0) },
      fee: {
        people: fees.length,
        amount: fees.reduce((s, x) => s + x.base, 0),
        tax: fees.reduce((s, x) => s + x.tax, 0),
        submitPeople: fees.filter((f) => f.mustSubmit).length,
        submitAmount: fees.filter((f) => f.mustSubmit).reduce((s, x) => s + x.base, 0),
        submitTax: fees.filter((f) => f.mustSubmit).reduce((s, x) => s + x.tax, 0),
      },
    },
  };
}

// ---- 納付 ----

export type RemittanceItem = { kind: "INCOME_TAX" | "RESIDENT_TAX"; key: string; label: string; detail: string; amount: number; deadline: string; paidAt: string | null };

export async function getRemittances(companyId: string, yearValue: unknown, today = jstDateKey(new Date())) {
  const year = checkYear(yearValue);
  const [company, payroll, fees, records] = await Promise.all([
    prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { withholdingSpecial: true, residentTaxSpecial: true, salaryPaidNextMonth: true } }),
    payrollByPayMonth(companyId),
    prisma.payment.findMany({ where: { companyId, withholding: true }, select: { amount: true, paymentDate: true, feeCategory: true } }),
    prisma.taxRemittance.findMany({ where: { companyId } }),
  ]);
  const items = new Map<string, RemittanceItem & { parts: Map<string, number> }>();
  const add = (kind: RemittanceItem["kind"], period: Period, part: string, amount: number) => {
    if (amount <= 0) return;
    const id = `${kind}|${period.key}`;
    const cur = items.get(id) ?? { kind, key: period.key, label: period.label, detail: "", amount: 0, deadline: period.deadline, paidAt: null, parts: new Map<string, number>() };
    cur.amount += amount;
    cur.parts.set(part, (cur.parts.get(part) ?? 0) + amount);
    items.set(id, cur);
  };
  for (const run of payroll) {
    const incomeTax = run.rows.reduce((s, r) => s + r.incomeTax, 0);
    const resident = run.rows.reduce((s, r) => s + r.residentTax, 0);
    add("INCOME_TAX", company.withholdingSpecial ? incomeTaxSpecialPeriod(run.payMonth) : monthlyPeriod(run.payMonth), run.kind, incomeTax);
    add("RESIDENT_TAX", company.residentTaxSpecial ? residentTaxSpecialPeriod(run.payMonth) : monthlyPeriod(run.payMonth), "住民税", resident);
  }
  for (const f of fees) {
    const month = jstDateKey(f.paymentDate).slice(0, 7);
    // 納期の特例が使えるのは士業の報酬だけ。ほかの報酬は毎月納める
    const special = company.withholdingSpecial && f.feeCategory === "PROFESSIONAL";
    add("INCOME_TAX", special ? incomeTaxSpecialPeriod(month) : monthlyPeriod(month), "報酬", f.amount);
  }
  const paid = new Map(records.map((r) => [`${r.kind}|${r.period}`, r]));
  const list = [...items.values()]
    .filter((i) => i.deadline.startsWith(`${year}-`) || i.key.startsWith(`${year}-`))
    .map(({ parts, ...i }) => ({
      ...i,
      detail: [...parts.entries()].map(([k, v]) => `${k} ${v.toLocaleString("ja-JP")}円`).join("・"),
      paidAt: paid.get(`${i.kind}|${i.key}`) ? jstDateKey(paid.get(`${i.kind}|${i.key}`)!.paidAt) : null,
      overdue: !paid.get(`${i.kind}|${i.key}`) && i.deadline < today,
    }))
    .sort((a, b) => a.deadline.localeCompare(b.deadline) || a.kind.localeCompare(b.kind));
  return { year, settings: company, items: list };
}

// 期限が10日以内か過ぎていて、まだ納付していないもの(ダッシュボード用)
export async function countRemittanceAlerts(companyId: string, now = new Date()) {
  const today = jstDateKey(now);
  const limit = new Date(Date.parse(`${today}T00:00:00Z`) + 10 * 86_400_000).toISOString().slice(0, 10);
  const year = Number(today.slice(0, 4));
  const [a, b] = await Promise.all([getRemittances(companyId, year, today), getRemittances(companyId, year - 1, today)]);
  const seen = new Set<string>();
  return [...a.items, ...b.items].filter((i) => {
    const id = `${i.kind}|${i.key}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return !i.paidAt && i.deadline <= limit;
  }).length;
}

export async function markRemitted(companyId: string, input: { kind?: unknown; period?: unknown; amount?: unknown; paidAt?: unknown; undo?: unknown }) {
  const kind = input.kind === "RESIDENT_TAX" ? "RESIDENT_TAX" : input.kind === "INCOME_TAX" ? "INCOME_TAX" : null;
  if (!kind) throw new UserError("税の種類が正しくありません");
  const period = String(input.period ?? "");
  if (!/^\d{4}-\d{2}(~\d{4}-\d{2})?$/.test(period)) throw new UserError("期間が正しくありません");
  if (input.undo === true) {
    await prisma.taxRemittance.deleteMany({ where: { companyId, kind, period } });
    return null;
  }
  const amount = Number(input.amount);
  if (!Number.isInteger(amount) || amount < 0) throw new UserError("金額が正しくありません");
  const paidAt = String(input.paidAt ?? jstDateKey(new Date()));
  if (!DATE.test(paidAt)) throw new UserError("納付日を正しく入力してください");
  return prisma.taxRemittance.upsert({
    where: { companyId_kind_period: { companyId, kind, period } },
    create: { companyId, kind, period, amount, paidAt: new Date(`${paidAt}T00:00:00Z`) },
    update: { amount, paidAt: new Date(`${paidAt}T00:00:00Z`) },
  });
}

export async function updateRemittanceSettings(companyId: string, input: { salaryPaidNextMonth?: unknown; withholdingSpecial?: unknown; residentTaxSpecial?: unknown }) {
  const data: Record<string, boolean> = {};
  for (const key of ["salaryPaidNextMonth", "withholdingSpecial", "residentTaxSpecial"] as const) if (typeof input[key] === "boolean") data[key] = input[key] as boolean;
  return prisma.company.update({ where: { id: companyId }, data, select: { salaryPaidNextMonth: true, withholdingSpecial: true, residentTaxSpecial: true } });
}

export async function updateVendorAddress(companyId: string, vendorId: string, address: unknown) {
  const vendor = await prisma.vendor.findFirst({ where: { id: vendorId, companyId } });
  if (!vendor) throw new UserError("取引先が見つかりません");
  const text = String(address ?? "").trim().slice(0, 200) || null;
  await prisma.vendor.update({ where: { id: vendorId }, data: { address: text } });
  return vendor.name;
}

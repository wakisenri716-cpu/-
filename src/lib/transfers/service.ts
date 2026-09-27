import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import type { PayrollSheetRow } from "@/lib/payroll/service";
import type { BonusRow } from "@/lib/payroll/bonus";
import { buildZenginFile, isZenginKana, toZenginKana, type Account, type Source, type TransferKind } from "./zengin";

// 振込データの作成: 給与振込(計上した給料の差引支給額)と総合振込(受け取った請求書の未払い分)。
// 作ったファイルはネットバンキングの「振込データの取込」で読み込む。記帳は銀行明細の取り込みで行う(ここでは仕訳を作らない)。

const OPEN = ["CONFIRMED", "SENT", "PARTIALLY_PAID", "OVERDUE"] as const;

function kanaField(value: unknown, label: string, max: number, required = true) {
  const kana = toZenginKana(String(value ?? ""));
  if (!kana) {
    if (required) throw new UserError(`${label}を入力してください(カタカナ)`);
    return "";
  }
  if (!isZenginKana(kana)) throw new UserError(`${label}に使えない文字があります。カタカナ・英大文字・数字で入力してください: ${kana}`);
  if (kana.length > max) throw new UserError(`${label}は半角${max}文字までです(濁点も1文字に数えます)`);
  return kana;
}

function digits(value: unknown, label: string, len: number, exact = true) {
  const v = String(value ?? "").normalize("NFKC").replace(/[\s-]/g, "");
  if (!/^\d+$/.test(v) || (exact ? v.length !== len : v.length > len)) throw new UserError(`${label}は${exact ? `${len}桁の` : `${len}桁までの`}数字で入力してください`);
  return exact ? v : v.padStart(len, "0");
}

export function parseAccount(input: Record<string, unknown>, withHolder: boolean): Account {
  const accountType = String(input.accountType ?? "1");
  if (accountType !== "1" && accountType !== "2") throw new UserError("預金の種類を選んでください");
  return {
    bankCode: digits(input.bankCode, "金融機関コード", 4),
    bankName: kanaField(input.bankName, "金融機関名", 15),
    branchCode: digits(input.branchCode, "支店コード", 3),
    branchName: kanaField(input.branchName, "支店名", 15),
    accountType,
    accountNumber: digits(input.accountNumber, "口座番号", 7, false),
    ...(withHolder ? { holder: kanaField(input.holder, "口座名義", 30) } : {}),
  };
}

const asAccount = (v: Prisma.JsonValue | null) => (v && typeof v === "object" && !Array.isArray(v) ? (v as unknown as Account) : null);

export async function updateTransferSource(companyId: string, input: Record<string, unknown>) {
  const source: Source = {
    ...parseAccount(input, false),
    requesterCode: digits(input.requesterCode, "委託者コード(依頼人コード)", 10, false),
    requesterName: kanaField(input.requesterName, "委託者名(依頼人名)", 40),
  };
  await prisma.company.update({ where: { id: companyId }, data: { transferSource: source as unknown as Prisma.InputJsonValue } });
  return source;
}

export async function setPayeeAccount(companyId: string, kind: "staff" | "vendor", id: string, input: Record<string, unknown> | null) {
  // null を渡すと振込先を消す
  const value = input ? (parseAccount(input, true) as unknown as Prisma.InputJsonValue) : Prisma.DbNull;
  if (kind === "staff") {
    const staff = await prisma.staff.findFirst({ where: { id, companyId } });
    if (!staff) throw new UserError("スタッフが見つかりません");
    await prisma.staff.update({ where: { id }, data: { payeeAccount: value } });
    return staff.name;
  }
  const vendor = await prisma.vendor.findFirst({ where: { id, companyId } });
  if (!vendor) throw new UserError("取引先が見つかりません");
  await prisma.vendor.update({ where: { id }, data: { payeeAccount: value } });
  return vendor.name;
}

export async function getTransferOverview(companyId: string) {
  const [company, staff, runs, invoices, vendors, bonuses] = await Promise.all([
    prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { transferSource: true } }),
    prisma.staff.findMany({ where: { companyId, active: true }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, payeeAccount: true } }),
    prisma.payrollRun.findMany({ where: { companyId }, orderBy: { month: "desc" }, take: 12, select: { month: true, details: true } }),
    prisma.invoice.findMany({
      where: { companyId, direction: "RECEIVED", status: { in: [...OPEN] } },
      include: { vendor: { select: { id: true, name: true, payeeAccount: true } }, payments: { select: { amount: true } } },
      orderBy: [{ dueDate: "asc" }, { issueDate: "asc" }],
    }),
    prisma.vendor.findMany({ where: { companyId }, orderBy: { name: "asc" }, select: { id: true, name: true, payeeAccount: true } }),
    prisma.bonusRun.findMany({ where: { companyId }, orderBy: { payDate: "desc" }, take: 12, select: { id: true, label: true, details: true } }),
  ]);
  return {
    source: asAccount(company.transferSource) as Source | null,
    staff: staff.map((s) => ({ id: s.id, name: s.name, account: asAccount(s.payeeAccount) })),
    vendors: vendors.map((v) => ({ id: v.id, name: v.name, account: asAccount(v.payeeAccount) })),
    payrollMonths: runs.map((r) => {
      const rows = Array.isArray(r.details) ? (r.details as unknown as PayrollSheetRow[]) : [];
      return { month: r.month, people: rows.length, total: rows.reduce((s, x) => s + x.netPay, 0), hasDetails: Array.isArray(r.details) };
    }),
    bonuses: bonuses.map((b) => {
      const rows = b.details as unknown as BonusRow[];
      return { id: b.id, label: b.label, people: rows.length, total: rows.reduce((s, x) => s + x.netPay, 0) };
    }),
    unpaid: invoices
      .map((i) => ({
        id: i.id,
        invoiceNumber: i.invoiceNumber,
        vendorId: i.vendor?.id ?? null,
        vendorName: i.vendor?.name ?? "(取引先なし)",
        hasAccount: !!asAccount(i.vendor?.payeeAccount ?? null),
        dueDate: i.dueDate,
        remaining: i.totalAmount - i.payments.reduce((s, p) => s + p.amount, 0),
      }))
      .filter((i) => i.remaining > 0),
  };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export type TransferPreview = { name: string; amount: number; account: Account | null; note: string };

// 振込の中身を作る(ファイルにする前の一覧)
async function transferLines(companyId: string, input: { kind?: unknown; month?: unknown; invoiceIds?: unknown; bonusId?: unknown }) {
  const kind = input.kind === "GENERAL" ? "GENERAL" : input.kind === "SALARY" ? "SALARY" : input.kind === "BONUS" ? "BONUS" : null;
  if (!kind) throw new UserError("振込の種類を選んでください");
  if (kind === "BONUS") {
    const run = await prisma.bonusRun.findFirst({ where: { id: String(input.bonusId ?? ""), companyId } });
    if (!run) throw new UserError("賞与を選んでください(「賞与」で計上したものから作れます)");
    const rows = (run.details as unknown as BonusRow[]).filter((r) => r.netPay > 0);
    const staff = await prisma.staff.findMany({ where: { companyId, id: { in: rows.map((r) => r.staffId) } }, select: { id: true, payeeAccount: true } });
    const byId = new Map(staff.map((s) => [s.id, asAccount(s.payeeAccount)]));
    return { kind: kind as TransferKind, lines: rows.map((r) => ({ name: r.name, amount: r.netPay, account: byId.get(r.staffId) ?? null, note: run.label })) };
  }
  if (kind === "SALARY") {
    const month = String(input.month ?? "");
    const run = await prisma.payrollRun.findUnique({ where: { companyId_month: { companyId, month } } });
    if (!run) throw new UserError("この月の給料はまだ計上していません。「給与計算」で計上してから作ってください");
    if (!Array.isArray(run.details)) throw new UserError("この月は控除の記録がないため、差引支給額がわかりません");
    const rows = (run.details as unknown as PayrollSheetRow[]).filter((r) => r.netPay > 0);
    const staff = await prisma.staff.findMany({ where: { companyId, id: { in: rows.map((r) => r.staffId) } }, select: { id: true, payeeAccount: true } });
    const byId = new Map(staff.map((s) => [s.id, asAccount(s.payeeAccount)]));
    const [y, m] = month.split("-").map(Number);
    return { kind: kind as TransferKind, lines: rows.map((r) => ({ name: r.name, amount: r.netPay, account: byId.get(r.staffId) ?? null, note: `${y}年${m}月分 給与` })) };
  }
  const ids = Array.isArray(input.invoiceIds) ? input.invoiceIds.map(String) : [];
  if (!ids.length) throw new UserError("振り込む請求書を選んでください");
  const overview = await getTransferOverview(companyId);
  const chosen = overview.unpaid.filter((i) => ids.includes(i.id));
  if (chosen.length !== ids.length) throw new UserError("選んだ請求書の中に、支払済み・取消済みのものがあります。画面を更新してください");
  // 同じ取引先への支払いは1回の振込にまとめる
  const byVendor = new Map<string, TransferPreview>();
  for (const i of chosen) {
    if (!i.vendorId) throw new UserError(`${i.invoiceNumber ?? "番号なし"}の請求書は取引先が決まっていません`);
    const v = overview.vendors.find((x) => x.id === i.vendorId)!;
    const cur = byVendor.get(i.vendorId) ?? { name: v.name, amount: 0, account: v.account, note: "" };
    cur.amount += i.remaining;
    cur.note = [cur.note, i.invoiceNumber ?? "番号なし"].filter(Boolean).join("・");
    byVendor.set(i.vendorId, cur);
  }
  return { kind: kind as TransferKind, lines: [...byVendor.values()] };
}

export async function previewTransfer(companyId: string, input: { kind?: unknown; month?: unknown; invoiceIds?: unknown; bonusId?: unknown }) {
  const { lines } = await transferLines(companyId, input);
  return { lines, total: lines.reduce((s, l) => s + l.amount, 0), missing: lines.filter((l) => !l.account).map((l) => l.name) };
}

export async function buildTransfer(companyId: string, input: { kind?: unknown; month?: unknown; invoiceIds?: unknown; bonusId?: unknown; date?: unknown }) {
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { transferSource: true } });
  const source = asAccount(company.transferSource) as Source | null;
  if (!source?.requesterCode) throw new UserError("先に「振込元の口座」(委託者コード・口座)を登録してください");
  const date = String(input.date ?? "");
  if (!DATE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) throw new UserError("振込日を正しく入力してください");
  const { kind, lines } = await transferLines(companyId, input);
  const missing = lines.filter((l) => !l.account);
  if (missing.length) throw new UserError(`${missing.map((l) => l.name).join("・")}の振込先の口座が登録されていません`);
  const file = buildZenginFile(
    kind,
    source,
    date,
    lines.map((l, i) => ({ account: l.account!, amount: l.amount, customerCode: String(i + 1) })),
  );
  return { file, kind, count: lines.length, total: lines.reduce((s, l) => s + l.amount, 0) };
}

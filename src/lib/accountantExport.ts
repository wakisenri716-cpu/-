import { prisma } from "@/lib/prisma";
import { buildCsv } from "@/lib/csv";
import { buildZip } from "@/lib/zip";
import { encodeShiftJis } from "@/lib/sjis";
import { jstDateKey } from "@/lib/jst";
import { getAccountBalances, normalSide, signedMovement } from "@/lib/accounting/ledger";
import { getConsumptionTax } from "@/lib/accounting/consumptionTax";
import { getAging } from "@/lib/accounting/receivables";
import { getFixedAssetsWithSummary } from "@/lib/accounting/fixedAssets";
import { SOURCE_LABELS } from "@/lib/accounting/journal";
import { CHART_OF_ACCOUNTS } from "@/lib/accounting/chartOfAccounts";
import { nextDay, toRange, type Period } from "@/lib/accounting/period";
import type { PayrollSheetRow } from "@/lib/payroll/service";

// 税理士に渡すデータ一式(ZIP)。
// - 仕訳は弥生会計・マネーフォワード クラウド会計に取り込める形式(Shift_JIS)と、Excel で見る形式(UTF-8)
// - 残高試算表・損益計算書・貸借対照表・総勘定元帳・固定資産台帳・売掛金/買掛金・消費税・給与の人別集計・証憑の一覧
// - 決算前に片づけておきたい「確認事項」

const POSTED = ["AUTO_POSTED", "POSTED_MANUALLY"] as const;
const CATEGORY: Record<string, string> = { ASSET: "資産", LIABILITY: "負債", EQUITY: "純資産", REVENUE: "収益", EXPENSE: "費用" };
const SEED_NAMES = new Set(CHART_OF_ACCOUNTS.map((a) => a.name));

const slash = (d: Date) => jstDateKey(d).replaceAll("-", "/");
const ymd = (d: Date) => d.toISOString().slice(0, 10).replaceAll("-", "/");

// 「普通預金(みずほ銀行)」のような科目は、会計ソフトでは「普通預金」の補助科目「みずほ銀行」にする
export function splitAccountName(name: string) {
  const m = name.match(/^(.+?)[(（](.+)[)）]$/);
  if (m && SEED_NAMES.has(m[1])) return { main: m[1], sub: m[2] };
  return { main: name, sub: "" };
}

type EntryWithLines = Awaited<ReturnType<typeof loadEntries>>[number];

async function loadEntries(companyId: string, period: { from: string | null; to: string | null }) {
  const range = toRange(period);
  return prisma.journalEntry.findMany({
    where: { companyId, status: { in: [...POSTED] }, ...(range.gte || range.lt ? { date: range } : {}) },
    include: { lines: { include: { account: true }, orderBy: { id: "asc" } }, department: { select: { name: true } } },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
  });
}

// 借方の行と貸方の行を上から順に1行ずつ組にする(会計ソフトの「複合仕訳」の形)
function pairLines(entry: EntryWithLines) {
  const debits = entry.lines.filter((l) => l.debit > 0);
  const credits = entry.lines.filter((l) => l.credit > 0);
  return Array.from({ length: Math.max(debits.length, credits.length) }, (_, i) => ({ debit: debits[i], credit: credits[i] }));
}

const clip = (text: string, max: number) => text.replace(/[\r\n]+/g, " ").slice(0, max);

// 弥生会計「仕訳日記帳」のインポート形式(25列)。1行の仕訳は 2000、複数行は 2110(最初)・2100(途中)・2101(最後)
export function yayoiRows(entries: EntryWithLines[]) {
  const rows: (string | number)[][] = [];
  entries.forEach((entry, index) => {
    const pairs = pairLines(entry);
    pairs.forEach((p, i) => {
      const flag = pairs.length === 1 ? 2000 : i === 0 ? 2110 : i === pairs.length - 1 ? 2101 : 2100;
      const d = p.debit ? splitAccountName(p.debit.account.name) : null;
      const c = p.credit ? splitAccountName(p.credit.account.name) : null;
      const dept = entry.department?.name ?? "";
      rows.push([
        flag,
        index + 1,
        "",
        ymd(entry.date),
        d?.main ?? "",
        d?.sub ?? "",
        d ? dept : "",
        d ? "対象外" : "",
        p.debit?.debit ?? "",
        d ? 0 : "",
        c?.main ?? "",
        c?.sub ?? "",
        c ? dept : "",
        c ? "対象外" : "",
        p.credit?.credit ?? "",
        c ? 0 : "",
        clip(p.debit?.memo && pairs.length > 1 ? `${entry.description} ${p.debit.memo}` : entry.description, 64),
        "",
        "",
        0,
        "",
        clip(SOURCE_LABELS[entry.sourceType] ?? "", 60),
        0,
        0,
        "no",
      ]);
    });
  });
  return rows;
}

// マネーフォワード クラウド会計「仕訳帳」のインポート形式。同じ取引No の行が1つの仕訳
export function moneyForwardRows(entries: EntryWithLines[]) {
  const header = [
    "取引No", "取引日", "借方勘定科目", "借方補助科目", "借方部門", "借方取引先", "借方税区分", "借方インボイス", "借方金額(円)", "借方税額",
    "貸方勘定科目", "貸方補助科目", "貸方部門", "貸方取引先", "貸方税区分", "貸方インボイス", "貸方金額(円)", "貸方税額", "摘要", "仕訳メモ", "タグ", "MF仕訳タイプ", "決算整理仕訳",
  ];
  const rows: (string | number)[][] = [header];
  entries.forEach((entry, index) => {
    for (const p of pairLines(entry)) {
      const d = p.debit ? splitAccountName(p.debit.account.name) : null;
      const c = p.credit ? splitAccountName(p.credit.account.name) : null;
      const dept = entry.department?.name ?? "";
      rows.push([
        index + 1,
        ymd(entry.date),
        d?.main ?? "", d?.sub ?? "", d ? dept : "", "", d ? "対象外" : "", "", p.debit?.debit ?? "", d ? 0 : "",
        c?.main ?? "", c?.sub ?? "", c ? dept : "", "", c ? "対象外" : "", "", p.credit?.credit ?? "", c ? 0 : "",
        clip(entry.description, 200), clip([SOURCE_LABELS[entry.sourceType], p.debit?.memo ?? p.credit?.memo].filter(Boolean).join(" "), 200), "", "", "",
      ]);
    }
  });
  return rows;
}

function journalRows(entries: EntryWithLines[]) {
  const rows: (string | number)[][] = [["日付", "伝票No", "借方科目コード", "借方勘定科目", "借方金額", "貸方科目コード", "貸方勘定科目", "貸方金額", "摘要", "部門", "種類", "メモ"]];
  entries.forEach((entry, index) => {
    for (const p of pairLines(entry)) {
      rows.push([
        ymd(entry.date), index + 1,
        p.debit?.account.code ?? "", p.debit?.account.name ?? "", p.debit?.debit ?? "",
        p.credit?.account.code ?? "", p.credit?.account.name ?? "", p.credit?.credit ?? "",
        entry.description, entry.department?.name ?? "", SOURCE_LABELS[entry.sourceType] ?? "", p.debit?.memo ?? p.credit?.memo ?? "",
      ]);
    }
  });
  return rows;
}

// 決算の前に片づけておきたいこと
export async function getExportChecks(companyId: string, period: { from: string | null; to: string | null }) {
  const range = toRange(period);
  const dateWhere = range.gte || range.lt ? { date: range } : {};
  const months: string[] = [];
  if (period.from && period.to) {
    for (let m = period.from.slice(0, 7); m <= period.to.slice(0, 7); ) {
      months.push(m);
      const [y, mo] = m.split("-").map(Number);
      m = new Date(Date.UTC(y, mo, 1)).toISOString().slice(0, 7);
    }
  }
  const [review, bank, company, shiftMonths, runs, noReceipt] = await Promise.all([
    prisma.journalEntry.count({ where: { companyId, status: "PENDING_REVIEW", ...dateWhere } }),
    prisma.bankTransaction.count({ where: { companyId, status: "PENDING", ...dateWhere } }),
    prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { booksClosedThrough: true } }),
    months.length
      ? prisma.shift.findMany({ where: { companyId, ...dateWhere }, select: { date: true }, distinct: ["date"] })
      : Promise.resolve([] as { date: Date }[]),
    prisma.payrollRun.findMany({ where: { companyId, month: { in: months } }, select: { month: true } }),
    prisma.expenseItem.count({ where: { expenseReport: { companyId }, receiptImageUrl: null, ...(range.gte || range.lt ? { expenseDate: range } : {}) } }),
  ]);
  const workedMonths = [...new Set(shiftMonths.map((s) => s.date.toISOString().slice(0, 7)))];
  const posted = new Set(runs.map((r) => r.month));
  const today = jstDateKey(new Date());
  const unpaidPayroll = workedMonths.filter((m) => !posted.has(m) && `${m}-31` < today).sort();
  const closed = company.booksClosedThrough ? jstDateKey(company.booksClosedThrough) : null;
  const items = [
    { ok: review === 0, label: "AI仕訳のレビュー待ち", detail: review ? `${review}件あります。レビューキューで確定してください` : "ありません", href: "/review" },
    { ok: bank === 0, label: "銀行・カード明細の確認待ち", detail: bank ? `${bank}件あります。科目を選んで確定してください` : "ありません", href: "/bank" },
    { ok: unpaidPayroll.length === 0, label: "給料の計上", detail: unpaidPayroll.length ? `${unpaidPayroll.join("・")} の給料が未計上です` : "勤務のある月はすべて計上済みです", href: "/payroll" },
    { ok: noReceipt === 0, label: "レシートのない経費", detail: noReceipt ? `${noReceipt}件あります(証憑の保存が必要です)` : "ありません", href: "/expenses" },
    {
      ok: !!closed && !!period.to && closed >= period.to,
      label: "締め処理",
      detail: closed ? `${closed.replaceAll("-", "/")} まで締めています${period.to && closed < period.to ? "(期間の最後まで締めると、渡した後に数字が変わりません)" : ""}` : "まだ締めていません(期間の最後まで締めると、渡した後に数字が変わりません)",
      href: "/closing",
    },
  ];
  return items;
}

export async function getExportSummary(companyId: string, period: Period) {
  const range = toRange(period);
  const [entries, checks] = await Promise.all([
    prisma.journalEntry.count({ where: { companyId, status: { in: [...POSTED] }, ...(range.gte || range.lt ? { date: range } : {}) } }),
    getExportChecks(companyId, period),
  ]);
  return { entries, checks };
}

export const EXPORT_FILES = [
  ["01_仕訳帳_弥生会計取込用.csv", "弥生会計の「仕訳日記帳」にそのまま取り込める形式(Shift_JIS)"],
  ["02_仕訳帳_マネーフォワード取込用.csv", "マネーフォワード クラウド会計の「仕訳帳」に取り込める形式(Shift_JIS)"],
  ["03_仕訳帳.csv", "Excel で見るための仕訳帳(科目コードつき)"],
  ["04_残高試算表.csv", "期首残高・期中の借方/貸方・期末残高"],
  ["05_損益計算書.csv", "期間の収益・費用・利益"],
  ["06_貸借対照表.csv", "期間の最終日時点の資産・負債・純資産"],
  ["07_総勘定元帳.csv", "科目ごとの取引と残高(前期繰越つき)"],
  ["08_固定資産台帳.csv", "資産ごとの取得価額・期中の償却額・帳簿価額"],
  ["09_売掛金・買掛金の残高.csv", "出力した日の時点の未入金・未払いの請求書"],
  ["10_消費税集計.csv", "期間の仮受・仮払消費税"],
  ["11_給与の人別集計.csv", "月別・人別の総支給額と源泉所得税など(源泉徴収票・法定調書の資料)"],
  ["12_証憑の一覧.csv", "期間のレシート・請求書の一覧(画像は各画面から)"],
] as const;

export async function buildAccountantPackage(companyId: string, period: Period) {
  const range = toRange(period);
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { name: true } });
  const entries = await loadEntries(companyId, period);

  // 残高試算表(期首・期中・期末)
  const [opening, movement, closing] = await Promise.all([
    period.from ? getAccountBalances(companyId, { lt: new Date(`${period.from}T00:00:00Z`) }) : Promise.resolve(null),
    getAccountBalances(companyId, range),
    getAccountBalances(companyId, period.to ? { lt: nextDay(period.to) } : {}),
  ]);
  const openingBy = new Map(opening?.map((r) => [r.account.id, r.balance]) ?? []);
  const closingBy = new Map(closing.map((r) => [r.account.id, r.balance]));
  const trial: (string | number)[][] = [["科目コード", "勘定科目", "区分", "期首残高", "借方発生額", "貸方発生額", "期末残高"]];
  for (const r of movement) {
    const open = r.account.category === "REVENUE" || r.account.category === "EXPENSE" ? 0 : (openingBy.get(r.account.id) ?? 0);
    const end = r.account.category === "REVENUE" || r.account.category === "EXPENSE" ? r.balance : (closingBy.get(r.account.id) ?? 0);
    if (!open && !r.totalDebit && !r.totalCredit && !end) continue;
    trial.push([r.account.code, r.account.name, CATEGORY[r.account.category], open, r.totalDebit, r.totalCredit, end]);
  }
  trial.push(["", "合計", "", "", movement.reduce((s, r) => s + r.totalDebit, 0), movement.reduce((s, r) => s + r.totalCredit, 0), ""]);

  // 損益計算書
  const pl: (string | number)[][] = [["区分", "科目コード", "勘定科目", "金額"]];
  const revenue = movement.filter((r) => r.account.category === "REVENUE" && r.balance);
  const expense = movement.filter((r) => r.account.category === "EXPENSE" && r.balance);
  for (const r of revenue) pl.push(["収益", r.account.code, r.account.name, r.balance]);
  const totalRevenue = revenue.reduce((s, r) => s + r.balance, 0);
  pl.push(["", "", "収益合計", totalRevenue]);
  for (const r of expense) pl.push(["費用", r.account.code, r.account.name, r.balance]);
  const totalExpense = expense.reduce((s, r) => s + r.balance, 0);
  pl.push(["", "", "費用合計", totalExpense], ["", "", "当期純利益", totalRevenue - totalExpense]);

  // 貸借対照表(期間の最終日時点。純資産には締めていない利益の累計を入れる)
  const bs: (string | number)[][] = [["区分", "科目コード", "勘定科目", "金額"]];
  const sum = (cat: string) => closing.filter((r) => r.account.category === cat).reduce((s, r) => s + r.balance, 0);
  for (const cat of ["ASSET", "LIABILITY", "EQUITY"]) {
    for (const r of closing.filter((x) => x.account.category === cat && x.balance)) bs.push([CATEGORY[cat], r.account.code, r.account.name, r.balance]);
    if (cat === "EQUITY") bs.push(["純資産", "", "繰越利益(締めていない損益の累計)", sum("REVENUE") - sum("EXPENSE")]);
    bs.push(["", "", `${CATEGORY[cat]}合計`, sum(cat) + (cat === "EQUITY" ? sum("REVENUE") - sum("EXPENSE") : 0)]);
  }

  // 総勘定元帳
  const ledger: (string | number)[][] = [["科目コード", "勘定科目", "日付", "伝票No", "摘要", "相手科目", "借方", "貸方", "残高"]];
  const entryNo = new Map(entries.map((e, i) => [e.id, i + 1]));
  const byAccount = new Map<string, { account: EntryWithLines["lines"][number]["account"]; rows: { entry: EntryWithLines; line: EntryWithLines["lines"][number] }[] }>();
  for (const e of entries) {
    for (const l of e.lines) {
      const cur = byAccount.get(l.accountId) ?? { account: l.account, rows: [] };
      cur.rows.push({ entry: e, line: l });
      byAccount.set(l.accountId, cur);
    }
  }
  for (const { account, rows } of [...byAccount.values()].sort((a, b) => a.account.code.localeCompare(b.account.code))) {
    const side = normalSide(account.category);
    const isProfitLoss = account.category === "REVENUE" || account.category === "EXPENSE";
    let balance = isProfitLoss ? 0 : (openingBy.get(account.id) ?? 0);
    ledger.push([account.code, account.name, period.from ? ymd(new Date(`${period.from}T00:00:00Z`)) : "", "", "前期繰越", "", "", "", balance]);
    for (const { entry, line } of rows) {
      balance += signedMovement(side, line.debit, line.credit);
      const counter = entry.lines.filter((x) => x.id !== line.id && (line.debit ? x.credit : x.debit));
      ledger.push([
        account.code,
        account.name,
        ymd(entry.date),
        entryNo.get(entry.id) ?? "",
        entry.description,
        counter.length === 1 ? counter[0].account.name : counter.length ? "諸口" : "",
        line.debit || "",
        line.credit || "",
        balance,
      ]);
    }
  }

  // 固定資産台帳
  const assets = await getFixedAssetsWithSummary(companyId);
  const fa: (string | number)[][] = [["資産名", "取得日", "取得価額", "耐用年数", "償却方法", "残存価額", "期中の償却額", "償却累計額", "帳簿価額(期末)", "状態"]];
  for (const a of assets) {
    const inPeriod = a.depreciationEntries.filter((d) => (!period.from || d.period >= period.from.slice(0, 7)) && (!period.to || d.period <= period.to.slice(0, 7)));
    const upTo = a.depreciationEntries.filter((d) => !period.to || d.period <= period.to.slice(0, 7));
    const accumulated = upTo.reduce((s, d) => s + d.amount, 0);
    fa.push([
      a.name,
      ymd(a.acquisitionDate),
      a.acquisitionCost,
      a.usefulLifeYears,
      "定額法",
      a.residualValue,
      inPeriod.reduce((s, d) => s + d.amount, 0),
      accumulated,
      a.acquisitionCost - accumulated,
      a.disposedAt ? `除却・売却(${ymd(a.disposedAt)})` : "使用中",
    ]);
  }

  // 売掛金・買掛金
  const [ar, ap] = await Promise.all([getAging(companyId, "ISSUED"), getAging(companyId, "RECEIVED")]);
  const aging: (string | number)[][] = [["区分", "取引先", "請求書番号", "請求日", "期日", "請求額", "残高", "超過日数"]];
  for (const [label, data] of [["売掛金", ar], ["買掛金", ap]] as const) {
    for (const r of data.rows) aging.push([label, r.partyName, r.invoiceNumber ?? "", r.issueDate ?? "", r.dueDate ?? "", r.total, r.remaining, r.overdueDays]);
    aging.push([label, "合計", "", "", "", "", data.total, ""]);
  }

  // 消費税
  const tax = await getConsumptionTax(companyId, range);
  const taxRows: (string | number)[][] = [["発生元", "仮受消費税", "仮払消費税"], ...tax.rows.map((r) => [r.label, r.output, r.input]), ["合計", tax.outputTotal, tax.inputTotal]];

  // 給与の人別・月別集計(計上した給料の記録から)
  const fromMonth = period.from?.slice(0, 7) ?? "0000-00";
  const toMonth = period.to?.slice(0, 7) ?? "9999-99";
  const runs = await prisma.payrollRun.findMany({ where: { companyId, month: { gte: fromMonth, lte: toMonth } }, orderBy: { month: "asc" } });
  const payroll: (string | number)[][] = [["月", "氏名", "総支給額", "うち通勤手当(非課税)", "健康保険料", "介護保険料", "厚生年金保険料", "雇用保険料", "源泉所得税", "住民税", "差引支給額"]];
  const perPerson = new Map<string, number[]>();
  for (const run of runs) {
    if (!Array.isArray(run.details)) {
      payroll.push([run.month, "(控除の記録なし)", run.totalAmount, "", "", "", "", "", "", "", ""]);
      continue;
    }
    for (const r of run.details as unknown as PayrollSheetRow[]) {
      const values = [r.gross, r.commute, r.health, r.care, r.pension, r.employment, r.incomeTax, r.residentTax, r.netPay];
      payroll.push([run.month, r.name, ...values]);
      const cur = perPerson.get(r.name) ?? values.map(() => 0);
      perPerson.set(r.name, cur.map((v, i) => v + values[i]));
    }
  }
  if (perPerson.size) {
    payroll.push([]);
    for (const [name, v] of perPerson) payroll.push(["期間の合計", name, ...v]);
  }

  // 証憑の一覧
  const docRange = range.gte || range.lt ? range : undefined;
  const [receipts, invoices] = await Promise.all([
    prisma.expenseItem.findMany({
      where: { expenseReport: { companyId }, ...(docRange ? { expenseDate: docRange } : {}) },
      select: { expenseDate: true, amount: true, description: true, receiptImageUrl: true, vendor: { select: { name: true } }, expenseReport: { select: { employee: { select: { name: true } } } } },
      orderBy: { expenseDate: "asc" },
    }),
    prisma.invoice.findMany({
      where: { companyId, status: { not: "CANCELLED" }, ...(docRange ? { issueDate: docRange } : {}) },
      select: { direction: true, invoiceNumber: true, issueDate: true, totalAmount: true, sourceFileUrl: true, vendor: { select: { name: true } }, customer: { select: { name: true } } },
      orderBy: { issueDate: "asc" },
    }),
  ]);
  const docs: (string | number)[][] = [["日付", "種類", "取引先", "金額", "内容・番号", "画像・ファイル"]];
  for (const r of receipts) docs.push([ymd(r.expenseDate), `経費(${r.expenseReport.employee?.name ?? ""})`, r.vendor?.name ?? "", r.amount, r.description, r.receiptImageUrl ? "あり" : "なし"]);
  for (const i of invoices) {
    docs.push([
      i.issueDate ? ymd(i.issueDate) : "",
      i.direction === "ISSUED" ? "発行した請求書" : "受け取った請求書",
      (i.direction === "ISSUED" ? i.customer?.name : i.vendor?.name) ?? "",
      i.totalAmount,
      i.invoiceNumber ?? "",
      i.direction === "ISSUED" ? "システムで作成" : i.sourceFileUrl ? "あり" : "なし",
    ]);
  }
  docs.splice(1, docs.length - 1, ...docs.slice(1).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));

  const checks = await getExportChecks(companyId, period);
  const readme = [
    `${company.name} 税理士さんへお渡しするデータ`,
    `期間: ${period.label}`,
    `作成: ${slash(new Date())} ${new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" }).format(new Date())}`,
    `仕訳: ${entries.length}件(記帳済みのもの。取消・レビュー待ちは含みません)`,
    "",
    "■ 入っているファイル",
    ...EXPORT_FILES.map(([name, desc]) => `・${name}\n    ${desc}`),
    "",
    "■ 確認事項",
    ...checks.map((c) => `${c.ok ? "○" : "△"} ${c.label}: ${c.detail}`),
    "",
    "■ 会計ソフトへの取り込みについて",
    "・消費税は「税抜経理」で、仮払消費税・仮受消費税を別の行で記帳しています。そのため税区分はすべて「対象外」にしています。",
    "・「普通預金(〇〇銀行)」「未払金(〇〇カード)」のような科目は、科目「普通預金」「未払金」と補助科目「〇〇銀行」「〇〇カード」に分けています。",
    "・会計ソフト側に同じ名前の勘定科目・補助科目・部門がない行は取り込めないことがあります。先に科目を追加するか、名前を合わせてください。",
    "・CSV は Excel で開けます(01・02 は Shift_JIS、それ以外は UTF-8)。",
  ].join("\r\n");

  const sjis = (rows: (string | number)[][]) => encodeShiftJis(buildCsv(rows).replace(/^﻿/, ""));
  const files = [
    { name: "00_はじめにお読みください.txt", data: `﻿${readme}\r\n` },
    { name: EXPORT_FILES[0][0], data: sjis(yayoiRows(entries)) },
    { name: EXPORT_FILES[1][0], data: sjis(moneyForwardRows(entries)) },
    { name: EXPORT_FILES[2][0], data: buildCsv(journalRows(entries)) },
    { name: EXPORT_FILES[3][0], data: buildCsv(trial) },
    { name: EXPORT_FILES[4][0], data: buildCsv(pl) },
    { name: EXPORT_FILES[5][0], data: buildCsv(bs) },
    { name: EXPORT_FILES[6][0], data: buildCsv(ledger) },
    { name: EXPORT_FILES[7][0], data: buildCsv(fa) },
    { name: EXPORT_FILES[8][0], data: buildCsv(aging) },
    { name: EXPORT_FILES[9][0], data: buildCsv(taxRows) },
    { name: EXPORT_FILES[10][0], data: buildCsv(payroll) },
    { name: EXPORT_FILES[11][0], data: buildCsv(docs) },
  ];
  return { zip: buildZip(files), company: company.name, entries: entries.length };
}

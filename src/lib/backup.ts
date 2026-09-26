import { prisma } from "@/lib/prisma";
import { buildCsv } from "@/lib/csv";
import { buildZip } from "@/lib/zip";
import { SOURCE_LABELS } from "@/lib/accounting/journal";
import { allFolders } from "@/lib/files";
import { listRecordHistory } from "@/lib/compliance";

const d = (date: Date | null | undefined) => (date ? date.toISOString().slice(0, 10) : "");
const JST = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
const t = (date: Date | null | undefined) => (date ? JST.format(date) : "");
const STATUS: Record<string, string> = { AUTO_POSTED: "記帳済み(自動)", POSTED_MANUALLY: "記帳済み", PENDING_REVIEW: "レビュー待ち", VOID: "取消" };

// 会社の全データを CSV にして ZIP にまとめる(画像は含めない)。
// 仕訳帳.csv は「仕訳のCSV取込」と同じ形式なので、別の環境にそのまま取り込み直せる。
export async function buildBackup(companyId: string) {
  const [company, accounts, entries, vendors, customers, invoices, quotes, reports, assets, products, staff, shifts, records, bank, recurring, budgets, logs] =
    await Promise.all([
      prisma.company.findUniqueOrThrow({ where: { id: companyId } }),
      prisma.account.findMany({ where: { companyId }, orderBy: { code: "asc" } }),
      prisma.journalEntry.findMany({
        where: { companyId },
        include: { lines: { include: { account: true } }, department: { select: { name: true } } },
        orderBy: [{ date: "asc" }, { createdAt: "asc" }],
      }),
      prisma.vendor.findMany({ where: { companyId }, orderBy: { name: "asc" } }),
      prisma.customer.findMany({ where: { companyId }, orderBy: { name: "asc" } }),
      prisma.invoice.findMany({
        where: { companyId },
        include: { vendor: true, customer: true, payments: true, lines: { orderBy: { sortOrder: "asc" } } },
        orderBy: { issueDate: "asc" },
      }),
      prisma.quote.findMany({ where: { companyId }, include: { customer: true, lines: { orderBy: { sortOrder: "asc" } } }, orderBy: { issueDate: "asc" } }),
      prisma.expenseReport.findMany({
        where: { companyId },
        include: { employee: true, items: { include: { account: true, vendor: true, journalEntry: { select: { status: true } } } } },
        orderBy: { createdAt: "asc" },
      }),
      prisma.fixedAsset.findMany({ where: { companyId }, include: { depreciationEntries: true }, orderBy: { acquisitionDate: "asc" } }),
      prisma.product.findMany({ where: { companyId }, include: { movements: { orderBy: { date: "asc" } } }, orderBy: { name: "asc" } }),
      prisma.staff.findMany({ where: { companyId }, orderBy: { createdAt: "asc" } }),
      prisma.shift.findMany({ where: { companyId }, include: { staff: true }, orderBy: [{ date: "asc" }, { startMinutes: "asc" }] }),
      prisma.timeRecord.findMany({ where: { companyId }, include: { staff: true }, orderBy: { clockIn: "asc" } }),
      prisma.bankTransaction.findMany({ where: { companyId }, orderBy: { date: "asc" } }),
      prisma.recurringEntry.findMany({ where: { companyId }, include: { lines: { include: { account: true }, orderBy: { sortOrder: "asc" } } } }),
      prisma.budget.findMany({ where: { companyId }, include: { account: true }, orderBy: [{ fiscalYear: "asc" }] }),
      prisma.auditLog.findMany({ where: { companyId }, orderBy: { createdAt: "asc" } }),
    ]);

  const minutes = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const [storedFiles, folderList] = await Promise.all([
    prisma.storedFile.findMany({ where: { companyId }, orderBy: { createdAt: "asc" }, select: { folderId: true, name: true, size: true, memo: true, uploadedByName: true, createdAt: true } }),
    allFolders(companyId),
  ]);
  const folderLabels = new Map(folderList.map((f) => [f.id, f.label]));
  const history = await listRecordHistory(companyId, { take: 500, changesOnly: true });

  const files: { name: string; rows: (string | number)[][] }[] = [
    {
      name: "仕訳帳.csv",
      rows: [
        ["日付", "伝票番号", "借方勘定科目", "借方金額", "貸方勘定科目", "貸方金額", "摘要", "部門", "種類", "状態"],
        ...entries.flatMap((e, i) =>
          e.lines.map((l) => [
            d(e.date),
            i + 1,
            l.debit ? l.account.code : "",
            l.debit || "",
            l.credit ? l.account.code : "",
            l.credit || "",
            e.description,
            e.department?.name ?? "",
            SOURCE_LABELS[e.sourceType],
            STATUS[e.status] ?? e.status,
          ]),
        ),
      ],
    },
    { name: "勘定科目.csv", rows: [["コード", "科目名", "区分", "非表示"], ...accounts.map((a) => [a.code, a.name, a.category, a.hidden ? "はい" : ""])] },
    {
      name: "取引先・顧客.csv",
      rows: [["種類", "名前", "既定の勘定科目"], ...vendors.map((v) => ["取引先", v.name, accounts.find((a) => a.id === v.defaultExpenseAccountId)?.code ?? ""]), ...customers.map((c) => ["顧客", c.name, ""])],
    },
    {
      name: "請求書.csv",
      rows: [
        ["区分", "請求書番号", "取引先・顧客", "請求日", "期日", "税抜", "消費税", "合計", "入金・支払済み", "状態", "備考"],
        ...invoices.map((i) => [
          i.direction === "ISSUED" ? "発行" : "受領",
          i.invoiceNumber ?? "",
          (i.direction === "ISSUED" ? i.customer?.name : i.vendor?.name) ?? "",
          d(i.issueDate),
          d(i.dueDate),
          i.subtotalAmount,
          i.taxAmount,
          i.totalAmount,
          i.payments.reduce((s, p) => s + p.amount, 0),
          i.status,
          i.notes ?? "",
        ]),
      ],
    },
    {
      name: "請求書・見積書の明細.csv",
      rows: [
        ["書類", "番号", "品目", "数量", "単位", "単価", "税率", "金額"],
        ...invoices.flatMap((i) => i.lines.map((l) => ["請求書", i.invoiceNumber ?? "", l.description, l.quantity, l.unit ?? "", l.unitPrice, l.taxRate, l.amount])),
        ...quotes.flatMap((q) => q.lines.map((l) => ["見積書", q.quoteNumber, l.description, l.quantity, l.unit ?? "", l.unitPrice, l.taxRate, l.amount])),
      ],
    },
    { name: "見積書.csv", rows: [["見積番号", "見積先", "見積日", "有効期限", "合計", "状態"], ...quotes.map((q) => [q.quoteNumber, q.customer.name, d(q.issueDate), d(q.validUntil), q.totalAmount, q.status])] },
    {
      name: "経費精算.csv",
      rows: [
        ["従業員", "作成日", "日付", "内容", "取引先", "勘定科目", "金額", "仕訳の状態", "精算日"],
        ...reports.flatMap((r) =>
          r.items.map((it) => [r.employee.name, d(r.createdAt), d(it.expenseDate), it.description, it.vendor?.name ?? "", it.account ? `${it.account.code} ${it.account.name}` : "", it.amount, it.journalEntry ? (STATUS[it.journalEntry.status] ?? "") : "", d(r.reimbursedAt)]),
        ),
      ],
    },
    {
      name: "固定資産.csv",
      rows: [
        ["資産名", "取得日", "取得価額", "残存価額", "耐用年数", "減価償却累計額", "除却・売却日", "売却額"],
        ...assets.map((a) => [a.name, d(a.acquisitionDate), a.acquisitionCost, a.residualValue, a.usefulLifeYears, a.depreciationEntries.reduce((s, e) => s + e.amount, 0), d(a.disposedAt), a.disposalPrice ?? ""]),
      ],
    },
    { name: "在庫.csv", rows: [["コード", "商品名", "単位", "在庫数", "在庫金額", "発注点"], ...products.map((p) => [p.code ?? "", p.name, p.unit, p.quantityOnHand, p.inventoryValue, p.reorderPoint ?? ""])] },
    {
      name: "在庫の動き.csv",
      rows: [["日付", "商品名", "種類", "数量", "金額", "メモ"], ...products.flatMap((p) => p.movements.map((m) => [d(m.date), p.name, m.type, m.quantity, m.amount, m.memo ?? ""]))],
    },
    { name: "スタッフ.csv", rows: [["名前", "時給", "在籍", "暗証番号"], ...staff.map((s) => [s.name, s.hourlyWage, s.active ? "在籍" : "退職", s.pinHash ? "設定済み" : ""])] },
    { name: "シフト.csv", rows: [["日付", "スタッフ", "開始", "終了", "休憩(分)", "メモ"], ...shifts.map((s) => [d(s.date), s.staff.name, minutes(s.startMinutes), minutes(s.endMinutes), s.breakMinutes, s.note ?? ""])] },
    { name: "勤怠(打刻).csv", rows: [["勤務日", "スタッフ", "出勤", "退勤", "休憩(分)", "修正済み"], ...records.map((r) => [d(r.date), r.staff.name, t(r.clockIn), t(r.clockOut), r.breakMinutes, r.edited ? "はい" : ""])] },
    { name: "銀行明細.csv", rows: [["日付", "摘要", "出金", "入金", "残高", "状態"], ...bank.map((b) => [d(b.date), b.description, b.withdrawal || "", b.deposit || "", b.balance ?? "", b.status])] },
    {
      name: "定期取引.csv",
      rows: [
        ["名前", "記帳日", "開始月", "終了月", "状態", "勘定科目", "借方", "貸方"],
        ...recurring.flatMap((r) => r.lines.map((l) => [r.name, r.dayOfMonth === 0 ? "月末" : `${r.dayOfMonth}日`, r.startMonth, r.endMonth ?? "", r.active ? "有効" : "停止中", `${l.account.code} ${l.account.name}`, l.debit || "", l.credit || ""])),
      ],
    },
    { name: "予算.csv", rows: [["年度", "勘定科目", "年間予算"], ...budgets.map((b) => [b.fiscalYear, `${b.account.code} ${b.account.name}`, b.amount])] },
    {
      name: "書類フォルダ.csv",
      rows: [
        ["フォルダ", "ファイル名", "サイズ(バイト)", "メモ", "保存した人", "保存日時"],
        ...storedFiles.map((f) => [f.folderId ? (folderLabels.get(f.folderId) ?? "") : "(いちばん上)", f.name, f.size, f.memo ?? "", f.uploadedByName, t(f.createdAt)]),
      ],
    },
    {
      name: "訂正・削除の履歴(直近500件).csv",
      rows: [["日時", "操作", "種類", "内容", "変更点"], ...history.map((h) => [t(h.changedAt), h.action, h.table, h.summary, h.changes.map((c) => `${c.field}: ${c.before} → ${c.after}`).join(" / ")])],
    },
    { name: "操作ログ.csv", rows: [["日時", "ユーザー", "操作", "内容"], ...logs.map((l) => [t(l.createdAt), l.userName, l.action, l.detail ?? ""])] },
  ];

  const readme = [
    `${company.name} のバックアップ(${t(new Date())} 作成)`,
    "",
    "・各ファイルは Excel で開ける CSV(UTF-8)です。",
    "・仕訳帳.csv は「仕訳のCSV取込」と同じ形式です(取消・レビュー待ちの仕訳も含むので、取り込み直すときは「状態」が記帳済みの行だけ残し、部門を使っていれば同じ名前の部門を先に登録してください)。",
    "・領収書・請求書の画像は含まれていません(「証憑の検索」から1件ずつ表示・保存できます)。",
    "・書類フォルダ.csv はファイルの一覧です。ファイルそのものは「書類フォルダ」の画面から1件ずつダウンロードしてください。",
    "",
  ].join("\r\n");

  return buildZip([{ name: "はじめにお読みください.txt", data: `﻿${readme}` }, ...files.map((f) => ({ name: f.name, data: buildCsv(f.rows) }))]);
}

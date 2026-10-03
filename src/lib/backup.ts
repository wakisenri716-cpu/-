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
      prisma.bankTransaction.findMany({ where: { companyId }, orderBy: { date: "asc" }, include: { bankAccount: { select: { name: true } } } }),
      prisma.recurringEntry.findMany({ where: { companyId }, include: { lines: { include: { account: true }, orderBy: { sortOrder: "asc" } } } }),
      prisma.budget.findMany({ where: { companyId }, include: { account: true }, orderBy: [{ fiscalYear: "asc" }] }),
      prisma.auditLog.findMany({ where: { companyId }, orderBy: { createdAt: "asc" } }),
    ]);
  const projects = await prisma.project.findMany({ where: { companyId }, include: { journalEntries: { select: { date: true, description: true } } }, orderBy: { createdAt: "asc" } });
  const loans = await prisma.loan.findMany({ where: { companyId }, include: { payments: { orderBy: { month: "asc" } } }, orderBy: { createdAt: "asc" } });
  const allocations = await prisma.allocation.findMany({ where: { companyId }, include: { postings: true }, orderBy: { createdAt: "asc" } });
  const yearEnds = await prisma.yearEndAdjustment.findMany({ where: { companyId, finalizedAt: { not: null } }, include: { staff: { select: { name: true } } }, orderBy: [{ year: "asc" }] });
  const workLogs = await prisma.workLog.findMany({ where: { companyId }, include: { user: { select: { name: true } }, project: { select: { name: true } } }, orderBy: [{ date: "asc" }, { createdAt: "asc" }] });
  const equipment = await prisma.equipment.findMany({ where: { companyId }, include: { loans: { orderBy: { lentAt: "asc" } } }, orderBy: [{ code: "asc" }, { name: "asc" }] });
  const orders = await prisma.purchaseOrder.findMany({ where: { companyId }, include: { vendor: true, lines: { orderBy: { sortOrder: "asc" } } }, orderBy: { issueDate: "asc" } });

  const minutes = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const [storedFiles, folderList] = await Promise.all([
    prisma.storedFile.findMany({ where: { companyId }, orderBy: { createdAt: "asc" }, select: { folderId: true, name: true, size: true, memo: true, uploadedByName: true, createdAt: true } }),
    allFolders(companyId),
  ]);
  const folderLabels = new Map(folderList.map((f) => [f.id, f.label]));
  const history = await listRecordHistory(companyId, { take: 500, changesOnly: true });
  const [leaveGrants, leaveTaken, approvalRequests] = await Promise.all([
    prisma.leaveGrant.findMany({ where: { companyId }, include: { staff: { select: { name: true } } }, orderBy: { grantDate: "asc" } }),
    prisma.leaveTaken.findMany({ where: { companyId }, include: { staff: { select: { name: true } } }, orderBy: { date: "asc" } }),
    prisma.approvalRequest.findMany({ where: { companyId }, include: { actions: { orderBy: { createdAt: "asc" } } }, orderBy: { createdAt: "asc" } }),
  ]);

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
      // 「取引先・顧客」のCSV取込と同じ形(住所・宛名も含めて取り込み直せる)
      rows: [
        ["種類", "名前", "既定の勘定科目", "郵便番号", "住所", "部署", "担当者", "敬称", "電話番号"],
        ...vendors.map((v) => ["取引先", v.name, accounts.find((a) => a.id === v.defaultExpenseAccountId)?.code ?? "", v.postalCode ?? "", v.address ?? "", v.department ?? "", v.contactName ?? "", v.honorific ?? "", v.phone ?? ""]),
        ...customers.map((c) => ["顧客", c.name, "", c.postalCode ?? "", c.address ?? "", c.department ?? "", c.contactName ?? "", c.honorific ?? "", c.phone ?? ""]),
      ],
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
      name: "請求書・見積書・発注書の明細.csv",
      rows: [
        ["書類", "番号", "品目", "数量", "単位", "単価", "税率", "金額"],
        ...invoices.flatMap((i) => i.lines.map((l) => ["請求書", i.invoiceNumber ?? "", l.description, l.quantity, l.unit ?? "", l.unitPrice, l.taxRate, l.amount])),
        ...quotes.flatMap((q) => q.lines.map((l) => ["見積書", q.quoteNumber, l.description, l.quantity, l.unit ?? "", l.unitPrice, l.taxRate, l.amount])),
        ...orders.flatMap((o) => o.lines.map((l) => ["発注書", o.orderNumber, l.description, l.quantity, l.unit ?? "", l.unitPrice, l.taxRate, l.amount])),
      ],
    },
    {
      name: "案件.csv",
      rows: [
        ["案件名", "顧客", "開始日", "終了日", "受注額の予算", "原価の予算", "状態", "付いている仕訳の数", "メモ"],
        ...projects.map((p) => [p.name, p.customerName ?? "", d(p.startDate), d(p.endDate), p.budgetRevenue ?? "", p.budgetCost ?? "", p.active ? "進行中" : "完了", p.journalEntries.length, p.notes ?? ""]),
      ],
    },
    {
      name: "発注書.csv",
      rows: [
        ["発注番号", "発注先", "発注日", "納期", "納品場所", "支払条件", "合計", "状態", "検収日"],
        ...orders.map((o) => [o.orderNumber, o.vendor.name, d(o.issueDate), d(o.deliveryDate), o.deliveryPlace ?? "", o.paymentTerms ?? "", o.totalAmount, o.status, d(o.receivedDate)]),
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
    {
      name: "与信限度額.csv",
      rows: [
        ["顧客", "与信限度額", "見直した日", "メモ"],
        ...customers.filter((c) => c.creditLimit !== null).map((c) => [c.name, c.creditLimit!, d(c.creditReviewedAt), c.creditNote ?? ""]),
      ],
    },
    {
      name: "借入金の返済.csv",
      rows: [
        ["借入", "借入額", "年利(%)", "回数", "返済方法", "返済月", "元金", "利息"],
        ...loans.flatMap((l) =>
          l.payments.length
            ? l.payments.map((p) => [l.name, l.principal, l.annualRate / 1000, l.months, l.method === "EQUAL_PAYMENT" ? "元利均等" : "元金均等", p.month, p.principal, p.interest])
            : [[l.name, l.principal, l.annualRate / 1000, l.months, l.method === "EQUAL_PAYMENT" ? "元利均等" : "元金均等", "", "", ""]],
        ),
      ],
    },
    {
      name: "期間按分.csv",
      rows: [
        ["種類", "名前", "金額", "最初の月", "月数", "科目", "計上した月数", "計上した額", "残り", "状態"],
        ...allocations.map((a) => {
          const posted = a.postings.reduce((s, p) => s + p.amount, 0);
          return [a.kind === "PREPAID_EXPENSE" ? "前払費用" : "前受金", a.name, a.totalAmount, a.startMonth, a.months, a.accountCode, a.postings.length, posted, a.totalAmount - posted, a.active ? "計上中" : "停止"];
        }),
      ],
    },
    {
      name: "年末調整(確定分).csv",
      rows: [
        ["年", "名前", "支払金額", "給与所得控除後", "社会保険料等", "所得控除の合計", "年税額", "徴収した税額", "過不足(+は還付)"],
        ...yearEnds.map((y) => {
          const r = y.result as { pay: number; income: number; social: number; deductions: number; annualTax: number; withheld: number; difference: number };
          return [y.year, y.staff.name, r.pay, r.income, r.social, r.deductions, r.annualTax, r.withheld, r.difference];
        }),
      ],
    },
    {
      name: "日報(工数).csv",
      rows: [
        ["日付", "名前", "案件", "時間(分)", "時間単価", "作業内容"],
        ...workLogs.map((l) => [d(l.date), l.user.name, l.project?.name ?? "社内の作業", l.minutes, l.hourlyCost, l.task ?? ""]),
      ],
    },
    {
      name: "備品.csv",
      rows: [
        ["管理番号", "備品名", "種類", "製造番号", "保管場所", "購入日", "購入金額", "状態", "メモ"],
        ...equipment.map((e) => [e.code ?? "", e.name, e.category ?? "", e.serialNumber ?? "", e.location ?? "", d(e.purchaseDate), e.price ?? "", e.status, e.notes ?? ""]),
      ],
    },
    {
      name: "備品の貸出.csv",
      rows: [
        ["管理番号", "備品名", "借りた人", "貸出日", "返却予定日", "返却日", "メモ"],
        ...equipment.flatMap((e) => e.loans.map((l) => [e.code ?? "", e.name, l.borrowerName, d(l.lentAt), d(l.dueDate), d(l.returnedAt), l.notes ?? ""])),
      ],
    },
    { name: "在庫.csv", rows: [["コード", "商品名", "単位", "在庫数", "在庫金額", "発注点"], ...products.map((p) => [p.code ?? "", p.name, p.unit, p.quantityOnHand, p.inventoryValue, p.reorderPoint ?? ""])] },
    {
      name: "在庫の動き.csv",
      rows: [["日付", "商品名", "種類", "数量", "金額", "メモ"], ...products.flatMap((p) => p.movements.map((m) => [d(m.date), p.name, m.type, m.quantity, m.amount, m.memo ?? ""]))],
    },
    {
      name: "スタッフ.csv",
      rows: [
        ["名前", "時給", "在籍", "暗証番号", "入社日", "週の所定労働日数", "1日の所定労働時間(分)"],
        ...staff.map((s) => [s.name, s.hourlyWage, s.active ? "在籍" : "退職", s.pinHash ? "設定済み" : "", s.hireDate ? d(s.hireDate) : "", s.weeklyDays, s.scheduledMinutes]),
      ],
    },
    {
      name: "申請・稟議.csv",
      rows: [
        ["番号", "申請日", "種類", "件名", "申請者", "金額", "購入先・支払先", "休む日", "状態", "回覧の記録", "内容"],
        ...approvalRequests.map((r) => [
          r.number,
          t(r.createdAt),
          ({ LEAVE: "有給休暇", PURCHASE: "購入・支払", GENERAL: "その他" } as Record<string, string>)[r.kind] ?? r.kind,
          r.title,
          r.requesterName,
          r.amount ?? "",
          r.payee ?? "",
          r.leaveDate ? `${d(r.leaveDate)}${r.leaveHalfDays === 1 ? "(半日)" : ""}` : "",
          ({ PENDING: "承認待ち", APPROVED: "承認", REJECTED: "差戻し", WITHDRAWN: "取下げ" } as Record<string, string>)[r.status] ?? r.status,
          r.actions.map((a) => `${t(a.createdAt)} ${a.userName} ${a.action}${a.comment ? `「${a.comment}」` : ""}`).join(" / "),
          r.body,
        ]),
      ],
    },
    {
      name: "有給休暇.csv",
      rows: [
        ["日付", "スタッフ", "種類", "日数", "メモ"],
        ...[
          ...leaveGrants.map((g) => [d(g.grantDate), g.staff.name, g.auto ? "付与(自動)" : "付与(手動)", g.halfDays / 2, g.note ?? ""]),
          ...leaveTaken.map((l) => [d(l.date), l.staff.name, l.bulk ? "取得(導入前の分)" : "取得", l.halfDays / 2, l.note ?? ""]),
        ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
      ],
    },
    { name: "シフト.csv", rows: [["日付", "スタッフ", "開始", "終了", "休憩(分)", "メモ"], ...shifts.map((s) => [d(s.date), s.staff.name, minutes(s.startMinutes), minutes(s.endMinutes), s.breakMinutes, s.note ?? ""])] },
    { name: "勤怠(打刻).csv", rows: [["勤務日", "スタッフ", "出勤", "退勤", "休憩(分)", "修正済み"], ...records.map((r) => [d(r.date), r.staff.name, t(r.clockIn), t(r.clockOut), r.breakMinutes, r.edited ? "はい" : ""])] },
    { name: "銀行明細.csv", rows: [["口座・カード", "日付", "摘要", "出金(カードは利用)", "入金(カードは返品)", "残高", "状態"], ...bank.map((b) => [b.bankAccount?.name ?? "普通預金", d(b.date), b.description, b.withdrawal || "", b.deposit || "", b.balance ?? "", b.status])] },
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

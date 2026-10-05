import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { formatYen } from "@/lib/format";
import { calcInvoice, issueInvoice, validDate, validateLines, type InvoiceLineInput } from "@/lib/accounting/issueInvoice";
import { createManualJournal, validateJournalLines } from "@/lib/accounting/journal";
import { buildDraft, sendDocumentMail } from "@/lib/documentMail";
import { listContracts, updateContract } from "@/lib/contracts";
import { cancelImportedInvoice, getPoMatches, linkInvoiceToOrder } from "@/lib/poMatching";
import { addDraftItems, sanitizeItems } from "./expenseText";
import { EXPENSE_ACCOUNT_CODES } from "@/lib/accounting/chartOfAccounts";

// AIアシスタントの下書き(提案)。AIは提案を作るだけで、確定は人が画面のボタンを押したときだけ行う。
// 提案は24時間で期限切れ。

const TTL_MS = 24 * 3_600_000;
export type ProposalKind = "INVOICE" | "JOURNAL" | "REMINDER" | "END_CONTRACT" | "LINK_PO" | "CANCEL_INVOICE" | "VENDOR_ACCOUNT" | "EXPENSE";
export type ProposalView = { id: string; kind: ProposalKind; summary: string; details: string[]; status: string; resultNote: string | null };

type Ctx = { companyId: string; userId: string };
type Input = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const int = (v: unknown) => (typeof v === "number" ? v : Number(String(v ?? "").replace(/[,円¥\s]/g, "")));

function endOfNextMonth(today: string) {
  const [y, m] = today.split("-").map(Number);
  return new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
}

async function save(ctx: Ctx, kind: ProposalKind, summary: string, payload: object, details: string[]) {
  const p = await prisma.assistantProposal.create({ data: { companyId: ctx.companyId, userId: ctx.userId, kind, summary, payload: { ...payload, details } } });
  return { proposalId: p.id, summary, details, note: "下書きを作りました。画面に表示された内容を利用者が確かめて「実行する」を押すと確定します(まだ確定していません)。" };
}

export async function proposeInvoice(ctx: Ctx, input: Input) {
  const today = jstDateKey(new Date());
  const customerName = str(input.customerName).slice(0, 100);
  if (!customerName) throw new UserError("請求先の名前が必要です");
  const issueDate = validDate(str(input.issueDate)) ? str(input.issueDate) : today;
  const dueDate = validDate(str(input.dueDate)) ? str(input.dueDate) : endOfNextMonth(issueDate);
  if (dueDate < issueDate) throw new UserError("支払期限が請求日より前です");
  const rawLines = Array.isArray(input.lines) ? (input.lines as Input[]) : [];
  const lines: InvoiceLineInput[] = validateLines(
    rawLines.slice(0, 50).map((l) => ({
      description: str(l.description).slice(0, 200),
      quantity: l.quantity === undefined ? 1 : Number(l.quantity),
      unit: str(l.unit) || null,
      unitPrice: int(l.unitPrice),
      taxRate: l.taxRate === undefined ? 10 : Number(l.taxRate),
    })),
  );
  const calc = calcInvoice(lines);
  if (calc.total <= 0) throw new UserError("合計が0円です");
  const known = await prisma.customer.findFirst({ where: { companyId: ctx.companyId, name: customerName }, select: { id: true } });
  const details = [
    `請求先: ${customerName}${known ? "" : "(新しい顧客として登録されます)"}`,
    `請求日: ${issueDate.replaceAll("-", "/")}・支払期限: ${dueDate.replaceAll("-", "/")}`,
    ...calc.lines.map((l) => `・${l.description} ${l.quantity}${l.unit ?? ""} × ${formatYen(l.unitPrice)}(${l.taxRate}%)= ${formatYen(l.amount)}`),
    `小計 ${formatYen(calc.subtotal)}・消費税 ${formatYen(calc.tax)}・合計 ${formatYen(calc.total)}`,
  ];
  return save(ctx, "INVOICE", `${customerName} への請求書 ${formatYen(calc.total)}(税込)`, { customerName, issueDate, dueDate, lines, notes: str(input.notes).slice(0, 500) || null }, details);
}

export async function proposeJournal(ctx: Ctx, input: Input) {
  const date = validDate(str(input.date)) ? str(input.date) : jstDateKey(new Date());
  const description = str(input.description).slice(0, 200);
  if (!description) throw new UserError("摘要が必要です");
  const accounts = await prisma.account.findMany({ where: { companyId: ctx.companyId, hidden: false }, select: { id: true, code: true, name: true } });
  const find = (q: string) => accounts.find((a) => a.code === q) ?? accounts.find((a) => a.name === q) ?? accounts.find((a) => a.name.includes(q) || (q.length >= 2 && q.includes(a.name)));
  const raw = Array.isArray(input.lines) ? (input.lines as Input[]) : [];
  const lines = raw.slice(0, 20).map((l, i) => {
    const a = find(str(l.account));
    if (!a) throw new UserError(`${i + 1}行目の勘定科目「${str(l.account)}」が見つかりません`);
    return { accountId: a.id, code: a.code, name: a.name, debit: int(l.debit ?? 0) || 0, credit: int(l.credit ?? 0) || 0 };
  });
  await validateJournalLines(ctx.companyId, lines);
  const total = lines.reduce((s, l) => s + l.debit, 0);
  const details = [`日付: ${date.replaceAll("-", "/")}・摘要: ${description}`, ...lines.map((l) => `・${l.debit ? `借方 ${l.code} ${l.name} ${formatYen(l.debit)}` : `貸方 ${l.code} ${l.name} ${formatYen(l.credit)}`}`)];
  return save(ctx, "JOURNAL", `仕訳「${description}」${formatYen(total)}`, { date, description, lines }, details);
}

export async function proposeReminder(ctx: Ctx, input: Input) {
  const q = str(input.invoice);
  if (!q) throw new UserError("請求書番号か顧客名が必要です");
  const invoices = await prisma.invoice.findMany({
    where: { companyId: ctx.companyId, direction: "ISSUED", status: { in: ["CONFIRMED", "SENT", "PARTIALLY_PAID", "OVERDUE"] } },
    include: { customer: { select: { name: true, email: true } }, payments: { select: { amount: true } } },
    orderBy: { dueDate: "asc" },
  });
  const today = jstDateKey(new Date());
  const matches = invoices.filter((i) => i.invoiceNumber === q || (i.customer?.name ?? "").includes(q));
  const overdue = matches.filter((i) => i.dueDate && jstDateKey(i.dueDate) < today && i.totalAmount - i.payments.reduce((s, p) => s + p.amount, 0) > 0);
  if (overdue.length === 0) throw new UserError(matches.length ? "その請求書は支払期限を過ぎていないか、入金済みです" : "その請求書が見つかりません");
  if (overdue.length > 1 && !overdue.some((i) => i.invoiceNumber === q)) {
    return { error: "期限を過ぎた請求書が複数あります。請求書番号で指定してください", candidates: overdue.map((i) => i.invoiceNumber) };
  }
  const inv = overdue.find((i) => i.invoiceNumber === q) ?? overdue[0];
  if (!inv.customer?.email) throw new UserError(`${inv.customer?.name ?? "顧客"}のメールアドレスが登録されていません。請求書の画面から送り先を入れて送ってください`);
  const remaining = inv.totalAmount - inv.payments.reduce((s, p) => s + p.amount, 0);
  const details = [`宛先: ${inv.customer.name}(${inv.customer.email})`, `請求書 ${inv.invoiceNumber ?? ""}・期限 ${jstDateKey(inv.dueDate!).replaceAll("-", "/")}・未入金 ${formatYen(remaining)}`, "いつもの督促の文面(請求書を見るリンクつき)で送ります"];
  return save(ctx, "REMINDER", `${inv.customer.name} へ督促メール(未入金 ${formatYen(remaining)})`, { invoiceId: inv.id }, details);
}

// 契約を「終了」にする(解約した・更新しないと決めた契約)
export async function proposeEndContract(ctx: Ctx, input: Input) {
  const q = str(input.contract);
  if (!q) throw new UserError("契約の名前か相手の名前が必要です");
  const { contracts } = await listContracts(ctx.companyId);
  const active = contracts.filter((c) => c.status === "ACTIVE");
  const exact = active.filter((c) => c.title === q || c.counterparty === q);
  const matches = exact.length ? exact : active.filter((c) => c.title.includes(q) || (c.counterparty ?? "").includes(q));
  if (matches.length === 0) throw new UserError(contracts.some((c) => c.title.includes(q) || (c.counterparty ?? "").includes(q)) ? "その契約はもう終了しています" : "その契約が見つかりません");
  if (matches.length > 1) return { error: "当てはまる契約が複数あります。契約の名前で指定してください", candidates: matches.map((c) => `${c.title}(${c.counterparty ?? "-"})`) };
  const c = matches[0];
  const details = [
    `契約: ${c.title}(${c.counterparty ?? "相手不明"})`,
    `期間: ${c.startDate?.replaceAll("-", "/") ?? "-"} 〜 ${c.nextEnd?.replaceAll("-", "/") ?? "-"}${c.autoRenew ? "・自動更新" : ""}`,
    ...(c.deadline ? [`解約の申し出期限: ${c.deadline.replaceAll("-", "/")}`] : []),
    ...(c.monthly ? [`月あたり ${formatYen(c.monthly)}(毎月の固定の契約費から外れます)`] : []),
    "台帳で「終了」にします。相手への解約の連絡は別に行ってください",
  ];
  return save(ctx, "END_CONTRACT", `契約「${c.title}」を終了にする`, { contractId: c.id }, details);
}

// 発注書と請求書の突き合わせを片付ける: 合う発注書で検収する(link) / 二重に取り込んだ請求書を取り消す(cancel)
export async function proposePoAction(ctx: Ctx, input: Input) {
  const q = str(input.invoice);
  if (!q) throw new UserError("請求書番号か取引先名が必要です");
  const action = str(input.action) === "cancel" ? "cancel" : "link";
  const rows = (await getPoMatches(ctx.companyId)).filter((r) => (action === "link" ? r.order && r.order.status === "OPEN" && (r.kind === "MATCH" || r.kind === "MISMATCH") : r.kind === "DOUBLE"));
  const exact = rows.filter((r) => r.invoice.number === q || r.order?.number === q);
  const matches = exact.length ? exact : rows.filter((r) => r.vendor.includes(q));
  if (matches.length === 0) throw new UserError(action === "link" ? "検収できる発注書と請求書の組が見つかりません" : "二重計上の疑いがある請求書が見つかりません");
  if (matches.length > 1) return { error: "当てはまるものが複数あります。請求書番号で指定してください", candidates: matches.map((r) => `${r.vendor} 請求書 ${r.invoice.number ?? "(番号なし)"} ${formatYen(r.invoice.total)}`) };
  const r = matches[0];
  const head = `${r.vendor}の請求書 ${r.invoice.number ?? "(番号なし)"}・${r.invoice.date.replaceAll("-", "/")}・${formatYen(r.invoice.total)}`;
  if (action === "link") {
    const details = [head, `発注書 ${r.order!.number}・${formatYen(r.order!.total)}`, r.diff === 0 ? "金額はぴったり合っています" : `差額 ${formatYen(r.diff)}(この請求書の金額で検収します)`, "発注書を検収済みにします(請求書の仕訳はもうあるので、新しい仕訳は作りません)"];
    return save(ctx, "LINK_PO", `発注書 ${r.order!.number} を請求書で検収する`, { orderId: r.order!.id, invoiceId: r.invoice.id }, details);
  }
  const details = [head, `発注書 ${r.order!.number} の検収ですでに計上済みです`, "取り込んだこの請求書を取り消し、仕訳も無効にします"];
  return save(ctx, "CANCEL_INVOICE", `二重に取り込んだ請求書を取り消す(${r.vendor} ${formatYen(r.invoice.total)})`, { invoiceId: r.invoice.id }, details);
}

// 取引先のいつもの勘定科目を決める(次から経費・請求書の読み取りでこの科目を使う)
export async function proposeVendorAccount(ctx: Ctx, input: Input) {
  const q = str(input.vendor);
  const a = str(input.account);
  if (!q || !a) throw new UserError("取引先の名前と勘定科目が必要です");
  const vendors = await prisma.vendor.findMany({ where: { companyId: ctx.companyId }, select: { id: true, name: true, defaultExpenseAccount: { select: { code: true, name: true } } } });
  const exact = vendors.filter((v) => v.name === q);
  const matches = exact.length ? exact : vendors.filter((v) => v.name.includes(q));
  if (matches.length === 0) throw new UserError("その取引先が見つかりません");
  if (matches.length > 1) return { error: "当てはまる取引先が複数あります。正しい名前で指定してください", candidates: matches.slice(0, 10).map((v) => v.name) };
  const v = matches[0];
  const accounts = await prisma.account.findMany({ where: { companyId: ctx.companyId, code: { in: EXPENSE_ACCOUNT_CODES }, hidden: false }, select: { id: true, code: true, name: true } });
  const account = accounts.find((x) => x.code === a) ?? accounts.find((x) => x.name === a) ?? accounts.find((x) => x.name.includes(a) || (a.length >= 2 && a.includes(x.name)));
  if (!account) throw new UserError(`経費の勘定科目「${a}」が見つかりません(使えるのは ${accounts.map((x) => x.name).join("・")})`);
  if (v.defaultExpenseAccount?.code === account.code) throw new UserError(`${v.name}はもう「${account.name}」になっています`);
  const details = [`取引先: ${v.name}`, `いつもの科目: ${v.defaultExpenseAccount ? `${v.defaultExpenseAccount.name} → ` : ""}${account.code} ${account.name}`, "次から、この取引先の経費・請求書をAIが読み取るときにこの科目を使います(これまでの仕訳は変わりません)"];
  return save(ctx, "VENDOR_ACCOUNT", `${v.name}のいつもの科目を「${account.name}」にする`, { vendorId: v.id, accountId: account.id }, details);
}

// 自分の経費精算に経費を入れる(「ひとことで経費入力」と同じ入れ方)
export async function proposeExpense(ctx: Ctx, input: Input) {
  const today = jstDateKey(new Date());
  const accounts = await prisma.account.findMany({ where: { companyId: ctx.companyId, code: { in: EXPENSE_ACCOUNT_CODES } }, select: { code: true, name: true } });
  const codeOf = (v: unknown) => {
    const a = str(v);
    return (accounts.find((x) => x.code === a) ?? accounts.find((x) => x.name === a) ?? accounts.find((x) => a && (x.name.includes(a) || (a.length >= 2 && a.includes(x.name)))))?.code ?? "5990";
  };
  const raw = Array.isArray(input.items) ? (input.items as Input[]) : [];
  const items = sanitizeItems(
    raw.map((i) => ({ date: i.date, description: i.description, amount: int(i.amount), accountCode: codeOf(i.account), vendorName: i.vendorName, confidence: 0.9 })),
    today,
  );
  if (!items.length) throw new UserError("入れる経費がありません");
  const bad = items.find((i) => i.amount <= 0 || i.amount > 1_000_000 || i.date > today);
  if (bad) throw new UserError(`「${bad.description}」の金額か日付を確かめてください`);
  const name = (code: string) => accounts.find((a) => a.code === code)?.name ?? code;
  const total = items.reduce((s, i) => s + i.amount, 0);
  const details = [...items.map((i) => `・${i.date.replaceAll("-", "/")} ${i.description}${i.vendorName ? `(${i.vendorName})` : ""} ${formatYen(i.amount)}・${name(i.accountCode)}`), `合計 ${formatYen(total)}`, "あなたの経費精算に入れます。領収書があるものは、あとで経費精算の画面から写真を付けてください"];
  return save(ctx, "EXPENSE", `経費 ${items.length}件 ${formatYen(total)} を精算に入れる`, { items }, details);
}

const view = (p: { id: string; kind: string; summary: string; payload: unknown; status: string; resultNote: string | null }): ProposalView => ({
  id: p.id,
  kind: p.kind as ProposalKind,
  summary: p.summary,
  details: ((p.payload as { details?: string[] })?.details ?? []).slice(0, 60),
  status: p.status,
  resultNote: p.resultNote,
});

export async function getProposals(companyId: string, ids: string[]) {
  if (!ids.length) return [];
  const rows = await prisma.assistantProposal.findMany({ where: { companyId, id: { in: ids } }, orderBy: { createdAt: "asc" } });
  return rows.map(view);
}

async function load(companyId: string, id: string) {
  const p = await prisma.assistantProposal.findFirst({ where: { id, companyId } });
  if (!p) throw new UserError("下書きが見つかりません");
  if (p.status !== "PENDING") throw new UserError(p.status === "DONE" ? "この下書きはもう実行しました" : "この下書きは取り消しました");
  if (Date.now() - p.createdAt.getTime() > TTL_MS) throw new UserError("この下書きは24時間たったので使えません。もう一度AIに頼んでください");
  return p;
}

// 人が「実行する」を押したときだけ呼ぶ
export async function executeProposal(companyId: string, user: { id: string; name: string }, id: string, baseUrl: string) {
  const p = await load(companyId, id);
  // 先に「実行中」にして二重実行を防ぐ
  const claimed = await prisma.assistantProposal.updateMany({ where: { id, status: "PENDING" }, data: { status: "RUNNING" } });
  if (claimed.count !== 1) throw new UserError("この下書きはもう実行しました");
  try {
    const payload = p.payload as Record<string, unknown>;
    let resultId: string;
    let note: string;
    if (p.kind === "INVOICE") {
      const inv = await issueInvoice(companyId, payload as never);
      resultId = inv.id;
      note = `請求書 ${inv.invoiceNumber} を作りました`;
    } else if (p.kind === "JOURNAL") {
      const lines = payload.lines as { accountId: string; debit: number; credit: number }[];
      const entry = await createManualJournal(companyId, { date: new Date(`${payload.date}T00:00:00Z`), description: String(payload.description), lines: lines.map((l) => ({ accountId: l.accountId, debit: l.debit, credit: l.credit })) });
      resultId = entry.id;
      note = "仕訳を記帳しました";
    } else if (p.kind === "REMINDER") {
      const invoiceId = String(payload.invoiceId);
      const draft = await buildDraft(companyId, "reminder", invoiceId, baseUrl);
      const log = await sendDocumentMail(companyId, { kind: "reminder", id: invoiceId, to: draft.to, subject: draft.subject, body: draft.body }, user.name);
      if (log.status === "FAILED") throw new UserError(`送れませんでした: ${log.error ?? ""}`);
      resultId = log.id;
      note = `${log.to} に督促メールを送りました`;
    } else if (p.kind === "END_CONTRACT") {
      const c = await updateContract(companyId, String(payload.contractId), { status: "ENDED" });
      resultId = c.id;
      note = `契約「${c.title}」を終了にしました`;
    } else if (p.kind === "LINK_PO") {
      await linkInvoiceToOrder(companyId, String(payload.orderId), String(payload.invoiceId));
      resultId = String(payload.orderId);
      note = "発注書を検収済みにしました";
    } else if (p.kind === "CANCEL_INVOICE") {
      const inv = await cancelImportedInvoice(companyId, String(payload.invoiceId));
      resultId = inv.id;
      note = "請求書を取り消し、仕訳を無効にしました";
    } else if (p.kind === "VENDOR_ACCOUNT") {
      const [vendor, account] = await Promise.all([
        prisma.vendor.findFirst({ where: { id: String(payload.vendorId), companyId }, select: { id: true, name: true } }),
        prisma.account.findFirst({ where: { id: String(payload.accountId), companyId }, select: { id: true, name: true } }),
      ]);
      if (!vendor || !account) throw new UserError("取引先か勘定科目が見つかりません");
      await prisma.vendor.update({ where: { id: vendor.id }, data: { defaultExpenseAccountId: account.id } });
      resultId = vendor.id;
      note = `${vendor.name}のいつもの科目を「${account.name}」にしました`;
    } else if (p.kind === "EXPENSE") {
      // 実行した人の経費精算に入れる
      const r = await addDraftItems({ id: user.id, companyId }, payload.items);
      resultId = r.reportId;
      note = `経費精算に ${formatYen(r.total)} を入れました`;
    } else {
      throw new UserError("この下書きは実行できません");
    }
    await prisma.assistantProposal.update({ where: { id }, data: { status: "DONE", resultId, resultNote: note, decidedAt: new Date() } });
    return { ...view({ ...p, status: "DONE", resultNote: note }), resultId };
  } catch (error) {
    await prisma.assistantProposal.update({ where: { id }, data: { status: "PENDING" } });
    throw error;
  }
}

export async function cancelProposal(companyId: string, id: string) {
  const p = await load(companyId, id);
  await prisma.assistantProposal.update({ where: { id: p.id }, data: { status: "CANCELLED", decidedAt: new Date() } });
  return view({ ...p, status: "CANCELLED" });
}


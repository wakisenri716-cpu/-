import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { formatYen } from "@/lib/format";
import { calcInvoice, issueInvoice, validDate, validateLines, type InvoiceLineInput } from "@/lib/accounting/issueInvoice";
import { createManualJournal, validateJournalLines } from "@/lib/accounting/journal";
import { buildDraft, sendDocumentMail } from "@/lib/documentMail";

// AIアシスタントの下書き(提案)。AIは提案を作るだけで、確定は人が画面のボタンを押したときだけ行う。
// 提案は24時間で期限切れ。

const TTL_MS = 24 * 3_600_000;
export type ProposalKind = "INVOICE" | "JOURNAL" | "REMINDER";
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
export async function executeProposal(companyId: string, user: { name: string }, id: string, baseUrl: string) {
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


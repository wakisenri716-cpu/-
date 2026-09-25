import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { getPrintableInvoice } from "@/lib/accounting/issueInvoice";
import { getQuote } from "@/lib/accounting/quotes";
import { formatYen } from "@/lib/format";
import { MailError, sendMail, type MailKind } from "@/lib/mail";

// 請求書・見積書・督促をメールで送る。書類そのものは添付せず、ログインなしで見られる共有リンクを本文に入れる
// (受け取った人はリンク先で印刷・PDF保存できる)。

export type DocumentMailKind = "invoice" | "quote" | "reminder";

const KIND: Record<DocumentMailKind, MailKind> = { invoice: "INVOICE", quote: "QUOTE", reminder: "REMINDER" };
const OPEN = ["CONFIRMED", "SENT", "PARTIALLY_PAID", "OVERDUE"];

function jp(d: Date | null) {
  return d ? `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日` : "";
}

const newToken = () => randomBytes(24).toString("base64url");

function signature(company: { name: string; address: string | null; phone: string | null; email: string | null }) {
  return ["", "--", company.name, company.address, company.phone && `TEL: ${company.phone}`, company.email && `Mail: ${company.email}`].filter((l) => l !== null && l !== undefined && l !== "").join("\n");
}

async function loadInvoice(companyId: string, id: string) {
  const data = await getPrintableInvoice(companyId, id);
  if (!data) throw new MailError("請求書が見つかりません(作成した請求書だけ送れます)");
  if (data.invoice.status === "CANCELLED") throw new MailError("取り消した請求書は送れません");
  return data;
}

// 送信画面に最初に入れておく宛先・件名・本文(共有リンクはここで作る)
export async function buildDraft(companyId: string, kind: DocumentMailKind, id: string, baseUrl: string) {
  if (kind === "quote") {
    const data = await getQuote(companyId, id);
    if (!data) throw new MailError("見積書が見つかりません");
    const { quote, calc } = data;
    if (quote.status === "CANCELLED") throw new MailError("取り消した見積書は送れません");
    const token = quote.shareToken ?? newToken();
    if (!quote.shareToken) await prisma.quote.update({ where: { id }, data: { shareToken: token } });
    return {
      to: quote.customer.email ?? "",
      subject: `【お見積書】${quote.quoteNumber} ${quote.company.name}`,
      body: [
        `${quote.customer.name} 御中`,
        "",
        `いつもお世話になっております。${quote.company.name}です。`,
        "ご依頼いただきましたお見積書をお送りします。下記のリンクからご確認ください。",
        "",
        `お見積金額: ${formatYen(calc.total)}(税込)`,
        `有効期限: ${jp(quote.validUntil)}`,
        "",
        "▼お見積書を見る(印刷・PDF保存できます)",
        `${baseUrl}/share/quote/${token}`,
        "",
        "ご不明な点がございましたら、お気軽にお問い合わせください。",
        signature(quote.company),
      ].join("\n"),
    };
  }

  const { invoice, calc } = await loadInvoice(companyId, id);
  const token = invoice.shareToken ?? newToken();
  if (!invoice.shareToken) await prisma.invoice.update({ where: { id }, data: { shareToken: token } });
  const link = `${baseUrl}/share/invoice/${token}`;
  const paid = invoice.payments.reduce((s, p) => s + p.amount, 0);
  const customer = invoice.customer?.name ?? "";
  const bank = invoice.company.bankAccount ? ["", "【お振込先】", invoice.company.bankAccount] : [];

  if (kind === "reminder") {
    const remaining = calc.total - paid;
    if (!OPEN.includes(invoice.status) || remaining <= 0) throw new MailError("この請求書は未入金の残高がありません");
    return {
      to: invoice.customer?.email ?? "",
      subject: `【ご入金のお願い】請求書 ${invoice.invoiceNumber ?? ""} ${invoice.company.name}`,
      body: [
        `${customer} 御中`,
        "",
        `いつもお世話になっております。${invoice.company.name}です。`,
        `${jp(invoice.issueDate)}付でお送りした請求書(${invoice.invoiceNumber ?? ""})につきまして、`,
        `お支払期限(${jp(invoice.dueDate)})を過ぎておりますが、本日時点でご入金の確認ができておりません。`,
        "お手数ですが、ご確認のうえお手続きをお願いいたします。",
        "",
        `未入金額: ${formatYen(remaining)}`,
        ...bank,
        "",
        "▼請求書を見る",
        link,
        "",
        "本メールと行き違いでお支払いいただいている場合は、ご容赦ください。",
        signature(invoice.company),
      ].join("\n"),
    };
  }

  return {
    to: invoice.customer?.email ?? "",
    subject: `【請求書】${invoice.invoiceNumber ?? ""} ${invoice.company.name}`,
    body: [
      `${customer} 御中`,
      "",
      `いつもお世話になっております。${invoice.company.name}です。`,
      `${jp(invoice.issueDate)}付の請求書をお送りします。下記のリンクからご確認ください。`,
      "",
      `ご請求金額: ${formatYen(calc.total)}(税込)`,
      invoice.dueDate ? `お支払期限: ${jp(invoice.dueDate)}` : "",
      ...bank,
      "",
      "▼請求書を見る(印刷・PDF保存できます)",
      link,
      "",
      "ご不明な点がございましたら、このメールにご返信ください。",
      signature(invoice.company),
    ]
      .filter((l, i, arr) => !(l === "" && arr[i - 1] === ""))
      .join("\n"),
  };
}

export async function sendDocumentMail(
  companyId: string,
  input: { kind: DocumentMailKind; id: string; to: unknown; subject: unknown; body: unknown },
  sentByName: string,
) {
  // 宛先の会社を確かめる(ほかの会社の書類を送れないように)
  const target =
    input.kind === "quote"
      ? await prisma.quote.findFirst({ where: { id: input.id, companyId }, select: { customerId: true, status: true } })
      : await prisma.invoice.findFirst({ where: { id: input.id, companyId, direction: "ISSUED" }, select: { customerId: true, status: true } });
  if (!target) throw new MailError("書類が見つかりません");
  if (target.status === "CANCELLED") throw new MailError("取り消した書類は送れません");

  const log = await sendMail({
    companyId,
    kind: KIND[input.kind],
    to: String(input.to ?? ""),
    subject: String(input.subject ?? ""),
    text: String(input.body ?? ""),
    sentByName,
    relatedId: input.id,
  });

  if (log.status !== "FAILED") {
    // 次回のために宛先を覚えておき、送った請求書は「送付済み」にする
    if (target.customerId) await prisma.customer.update({ where: { id: target.customerId }, data: { email: log.to } });
    if (input.kind === "invoice") await prisma.invoice.updateMany({ where: { id: input.id, companyId, status: "CONFIRMED" }, data: { status: "SENT" } });
  }
  return log;
}

// 共有リンク(ログイン不要)で開く書類
export async function getSharedInvoice(token: string) {
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) return null;
  const invoice = await prisma.invoice.findUnique({ where: { shareToken: token }, select: { id: true, companyId: true } });
  return invoice ? getPrintableInvoice(invoice.companyId, invoice.id) : null;
}

export async function getSharedQuote(token: string) {
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) return null;
  const quote = await prisma.quote.findUnique({ where: { shareToken: token }, select: { id: true, companyId: true } });
  return quote ? getQuote(quote.companyId, quote.id) : null;
}

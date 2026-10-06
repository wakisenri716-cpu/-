import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { getAiProvider } from "@/lib/ai";
import { aiEnabled } from "@/lib/ai/access";
import { findOrCreateVendor } from "@/lib/accounting/parties";
import { postInvoiceJournal } from "@/lib/accounting/automation";
import { autoMatchImportedInvoice } from "@/lib/poMatching";
import { getPrintableInvoice } from "@/lib/accounting/issueInvoice";
import { keywordCode } from "@/lib/accountReview";
import { EXPENSE_ACCOUNT_CODES } from "@/lib/accounting/chartOfAccounts";

// デジタルインボイス(Peppol の日本の標準仕様 JP PINT。中身は UBL 2.1 の XML)
// ・発行した請求書を JP PINT の XML で書き出す(Peppol で送るときは、アクセスポイント事業者のサービスに渡す)
// ・受け取ったデジタルインボイスの XML を読み込み、受け取った請求書(明細つき)と仕訳を作る。数字は XML のまま使うので、AI の読み取りは要らない
// 金額は円(JPY)だけを扱う。

const CUSTOMIZATION_ID = "urn:peppol:pint:billing-1@jp-1";
const PROFILE_ID = "urn:peppol:bis:billing";
const MAX_XML = 2 * 1024 * 1024;

// ---------- 書き出し ----------

const esc = (v: unknown) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
const yen = (n: number) => `<cbc:__ currencyID="JPY">${Math.round(n)}</cbc:__>`;
const money = (tag: string, n: number) => yen(n).replace(/__/g, tag);
// 標準税率は S、軽減税率(8%)は AA、0% は Z
const taxCategory = (rate: number) => (rate === 0 ? "Z" : rate === 8 ? "AA" : "S");
const taxBlock = (tag: string, rate: number) =>
  `<cac:${tag}><cbc:ID>${taxCategory(rate)}</cbc:ID><cbc:Percent>${rate}</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:${tag}>`;

function party(name: string, address: string | null, registrationNumber: string | null) {
  return [
    "<cac:Party>",
    `<cac:PartyName><cbc:Name>${esc(name)}</cbc:Name></cac:PartyName>`,
    `<cac:PostalAddress>${address ? `<cbc:StreetName>${esc(address)}</cbc:StreetName>` : ""}<cac:Country><cbc:IdentificationCode>JP</cbc:IdentificationCode></cac:Country></cac:PostalAddress>`,
    registrationNumber ? `<cac:PartyTaxScheme><cbc:CompanyID>${esc(registrationNumber)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>` : "",
    `<cac:PartyLegalEntity><cbc:RegistrationName>${esc(name)}</cbc:RegistrationName></cac:PartyLegalEntity>`,
    "</cac:Party>",
  ].join("");
}

export async function buildPeppolXml(companyId: string, invoiceId: string) {
  const data = await getPrintableInvoice(companyId, invoiceId);
  if (!data) throw new UserError("書き出せるのは、明細のある発行済みの請求書です");
  const { invoice, calc } = data;
  if (["DRAFT", "CANCELLED"].includes(invoice.status)) throw new UserError("下書き・取り消した請求書は書き出せません");
  const company = invoice.company;
  const paid = invoice.payments.reduce((s, p) => s + p.amount, 0);
  const regNo = company.registrationNumber ? (company.registrationNumber.startsWith("T") ? company.registrationNumber : `T${company.registrationNumber}`) : null;
  const xml = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">`,
    `<cbc:CustomizationID>${CUSTOMIZATION_ID}</cbc:CustomizationID>`,
    `<cbc:ProfileID>${PROFILE_ID}</cbc:ProfileID>`,
    `<cbc:ID>${esc(invoice.invoiceNumber ?? invoice.id)}</cbc:ID>`,
    `<cbc:IssueDate>${jstDateKey(invoice.issueDate ?? invoice.createdAt)}</cbc:IssueDate>`,
    invoice.dueDate ? `<cbc:DueDate>${jstDateKey(invoice.dueDate)}</cbc:DueDate>` : "",
    `<cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>`,
    invoice.notes ? `<cbc:Note>${esc(invoice.notes)}</cbc:Note>` : "",
    `<cbc:DocumentCurrencyCode>JPY</cbc:DocumentCurrencyCode>`,
    `<cbc:TaxCurrencyCode>JPY</cbc:TaxCurrencyCode>`,
    `<cac:AccountingSupplierParty>${party(company.name, company.address, regNo)}</cac:AccountingSupplierParty>`,
    `<cac:AccountingCustomerParty>${party(invoice.customer?.name ?? "", invoice.customer?.address ?? null, null)}</cac:AccountingCustomerParty>`,
    company.bankAccount
      ? `<cac:PaymentMeans><cbc:PaymentMeansCode>30</cbc:PaymentMeansCode><cac:PayeeFinancialAccount><cbc:ID>${esc(company.bankAccount)}</cbc:ID></cac:PayeeFinancialAccount></cac:PaymentMeans>`
      : "",
    `<cac:TaxTotal>${money("TaxAmount", calc.tax)}`,
    ...calc.byRate.map((r) => `<cac:TaxSubtotal>${money("TaxableAmount", r.base)}${money("TaxAmount", r.tax)}${taxBlock("TaxCategory", r.rate)}</cac:TaxSubtotal>`),
    `</cac:TaxTotal>`,
    `<cac:LegalMonetaryTotal>${money("LineExtensionAmount", calc.subtotal)}${money("TaxExclusiveAmount", calc.subtotal)}${money("TaxInclusiveAmount", calc.total)}${paid > 0 ? money("PrepaidAmount", paid) : ""}${money("PayableAmount", calc.total - paid)}</cac:LegalMonetaryTotal>`,
    ...invoice.lines.map(
      (l, i) =>
        `<cac:InvoiceLine><cbc:ID>${i + 1}</cbc:ID><cbc:InvoicedQuantity unitCode="H87">${l.quantity}</cbc:InvoicedQuantity>${money("LineExtensionAmount", l.amount)}<cac:Item>${l.unit ? `<cbc:Description>単位: ${esc(l.unit)}</cbc:Description>` : ""}<cbc:Name>${esc(l.description)}</cbc:Name>${taxBlock("ClassifiedTaxCategory", l.taxRate)}</cac:Item><cac:Price>${money("PriceAmount", l.unitPrice)}</cac:Price></cac:InvoiceLine>`,
    ),
    `</Invoice>`,
  ]
    .filter(Boolean)
    .join("\n");
  return { xml, fileName: `${(invoice.invoiceNumber ?? invoice.id).replace(/[^\w.-]+/g, "_")}.xml` };
}

// ---------- 読み込み ----------

export type XmlNode = { name: string; attrs: Record<string, string>; children: XmlNode[]; text: string };

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENTITIES[e.toLowerCase()],
  );
const local = (name: string) => name.slice(name.indexOf(":") + 1);

// 小さな XML の読み取り(要素・属性・文字・CDATA。DTD や外部の参照は読まない)
export function parseXml(text: string): XmlNode {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new UserError("この XML は読み込めません(DOCTYPE を含んでいます)");
  const root: XmlNode = { name: "#root", attrs: {}, children: [], text: "" };
  const stack: XmlNode[] = [root];
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<\/([^\s>]+)\s*>|<([^\s/>]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.text += m[1];
    else if (m[2]) {
      if (local(m[2]) !== top.name || stack.length === 1) throw new UserError("XML の形が正しくありません");
      stack.pop();
    } else if (m[3]) {
      const attrs: Record<string, string> = {};
      for (const a of (m[4] ?? "").matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[local(a[1])] = decode(a[2] ?? a[3] ?? "");
      const node: XmlNode = { name: local(m[3]), attrs, children: [], text: "" };
      top.children.push(node);
      if (!m[5]) stack.push(node);
    } else if (m[6] !== undefined) top.text += decode(m[6]);
  }
  if (stack.length !== 1) throw new UserError("XML の形が正しくありません(閉じていない要素があります)");
  const doc = root.children[0];
  if (!doc) throw new UserError("XML が空です");
  return doc;
}

const child = (n: XmlNode | undefined, ...path: string[]): XmlNode | undefined => path.reduce<XmlNode | undefined>((cur, p) => cur?.children.find((c) => c.name === p), n);
const children = (n: XmlNode | undefined, name: string) => n?.children.filter((c) => c.name === name) ?? [];
const textOf = (n: XmlNode | undefined, ...path: string[]) => child(n, ...path)?.text.trim() || null;
const num = (v: string | null) => (v === null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));

export type ParsedInvoice = {
  number: string;
  issueDate: string;
  dueDate: string | null;
  supplier: { name: string; registrationNumber: string | null; address: string | null };
  customerName: string | null;
  lines: { description: string; quantity: number; unitPrice: number; amount: number; taxRate: number }[];
  subtotal: number;
  tax: number;
  total: number;
  payable: number;
  note: string | null;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseUblInvoice(xml: string): ParsedInvoice {
  const doc = parseXml(xml);
  if (doc.name === "CreditNote") throw new UserError("取り消し・返金の書類(CreditNote)は、まだ読み込めません");
  if (doc.name !== "Invoice") throw new UserError("デジタルインボイス(UBL の Invoice)ではありません");
  const currency = textOf(doc, "DocumentCurrencyCode") ?? "JPY";
  if (currency !== "JPY") throw new UserError(`円以外の請求書(${currency})は読み込めません`);
  const number = textOf(doc, "ID");
  const issueDate = textOf(doc, "IssueDate");
  if (!number) throw new UserError("請求書番号(ID)がありません");
  if (!issueDate || !DATE.test(issueDate)) throw new UserError("請求日(IssueDate)がありません");
  const dueDate = textOf(doc, "DueDate") ?? textOf(doc, "PaymentMeans", "PaymentDueDate") ?? textOf(doc, "PaymentTerms", "PaymentDueDate");

  const sp = child(doc, "AccountingSupplierParty", "Party");
  const supplierName = textOf(sp, "PartyLegalEntity", "RegistrationName") ?? textOf(sp, "PartyName", "Name");
  if (!supplierName) throw new UserError("請求元(AccountingSupplierParty)の名前がありません");
  const regRaw = children(sp, "PartyTaxScheme").map((t) => textOf(t, "CompanyID")).find((v) => v && /^T?\d{13}$/.test(v)) ?? null;
  const registrationNumber = regRaw ? (regRaw.startsWith("T") ? regRaw : `T${regRaw}`) : null;
  const addr = child(sp, "PostalAddress");
  const address = [textOf(addr, "PostalZone"), textOf(addr, "CountrySubentity"), textOf(addr, "CityName"), textOf(addr, "StreetName"), textOf(addr, "AdditionalStreetName")].filter(Boolean).join(" ") || null;
  const cp = child(doc, "AccountingCustomerParty", "Party");
  const customerName = textOf(cp, "PartyLegalEntity", "RegistrationName") ?? textOf(cp, "PartyName", "Name");

  const lines = children(doc, "InvoiceLine").map((l, i) => {
    const amount = num(textOf(l, "LineExtensionAmount"));
    if (amount === null) throw new UserError(`${i + 1}行目の金額(LineExtensionAmount)がありません`);
    const quantity = num(textOf(l, "InvoicedQuantity")) ?? 1;
    const price = num(textOf(l, "Price", "PriceAmount"));
    const rate = num(textOf(l, "Item", "ClassifiedTaxCategory", "Percent")) ?? 10;
    return {
      description: (textOf(l, "Item", "Name") ?? textOf(l, "Item", "Description") ?? `明細${i + 1}`).slice(0, 200),
      quantity,
      unitPrice: Math.round(price ?? (quantity ? amount / quantity : amount)),
      amount: Math.round(amount),
      taxRate: Math.round(rate),
    };
  });
  if (!lines.length) throw new UserError("明細(InvoiceLine)がありません");

  const totals = child(doc, "LegalMonetaryTotal");
  const subtotal = num(textOf(totals, "TaxExclusiveAmount")) ?? num(textOf(totals, "LineExtensionAmount")) ?? lines.reduce((s, l) => s + l.amount, 0);
  // 税額は円(JPY)のものを使う(TaxTotal が通貨ごとに2つあることがある)
  const taxTotals = children(doc, "TaxTotal");
  const taxNode = taxTotals.find((t) => child(t, "TaxAmount")?.attrs.currencyID === "JPY") ?? taxTotals[0];
  const tax = num(textOf(taxNode, "TaxAmount")) ?? 0;
  const total = num(textOf(totals, "TaxInclusiveAmount")) ?? subtotal + tax;
  const payable = num(textOf(totals, "PayableAmount")) ?? total;
  if (Math.abs(subtotal + tax - total) > 1) throw new UserError(`金額が合いません(税抜 ${subtotal} + 税 ${tax} と 税込 ${total})`);
  if (total <= 0) throw new UserError("請求金額が0円以下です");
  return {
    number: number.slice(0, 100),
    issueDate,
    dueDate: dueDate && DATE.test(dueDate) ? dueDate : null,
    supplier: { name: supplierName.slice(0, 100), registrationNumber, address },
    customerName,
    lines,
    subtotal: Math.round(subtotal),
    tax: Math.round(tax),
    total: Math.round(total),
    payable: Math.round(payable),
    note: textOf(doc, "Note"),
  };
}

// 科目: 取引先のいつもの科目 → 明細の言葉 → AI の見立て → 雑費(この場合はレビュー待ちになる)
async function pickAccount(companyId: string, vendorDefault: string | null, parsed: ParsedInvoice) {
  if (vendorDefault) return { code: vendorDefault, confidence: 0.97, reason: "取引先のいつもの科目" };
  const words = parsed.lines.map((l) => l.description).join(" ");
  const kw = keywordCode(words);
  if (kw) return { code: kw, confidence: 0.9, reason: "明細の言葉から" };
  if (!(await aiEnabled(companyId))) return { code: "5990", confidence: 0.5, reason: "科目を決められなかったので雑費(レビューで直してください)" };
  const accounts = await prisma.account.findMany({ where: { companyId, code: { in: EXPENSE_ACCOUNT_CODES } }, select: { code: true, name: true } });
  try {
    const [guess] = await (await getAiProvider(companyId)).classifyBankTransactions([{ description: `${parsed.supplier.name} ${words}`.slice(0, 300), direction: "OUT", amount: parsed.total }], accounts);
    if (guess && accounts.some((a) => a.code === guess.accountCode)) return { code: guess.accountCode, confidence: Math.min(guess.confidence, 0.9), reason: `AIの見立て: ${guess.reason}` };
  } catch {
    // AI が使えないときは雑費にしてレビューへ
  }
  return { code: "5990", confidence: 0.5, reason: "科目を決められなかったので雑費(レビューで直してください)" };
}

export async function importPeppolInvoice(companyId: string, xml: string) {
  if (Buffer.byteLength(xml, "utf8") > MAX_XML) throw new UserError("XML が大きすぎます(2MBまで)");
  const parsed = parseUblInvoice(xml);
  const vendor = await findOrCreateVendor(companyId, parsed.supplier.name);
  const sha = createHash("sha256").update(xml).digest("hex");
  const dup = await prisma.invoice.findFirst({
    where: { companyId, direction: "RECEIVED", OR: [{ sourceSha256: sha }, { vendorId: vendor.id, invoiceNumber: parsed.number }] },
    select: { id: true },
  });
  if (dup) throw new UserError(`この請求書(${parsed.supplier.name} ${parsed.number})はもう取り込んであります`);
  // 登録番号はデジタルインボイスに書かれたものを取引先に残す(まだ空のときだけ)
  if (parsed.supplier.registrationNumber && !vendor.registrationNumber) {
    await prisma.vendor.update({ where: { id: vendor.id }, data: { registrationNumber: parsed.supplier.registrationNumber, ...(vendor.address ? {} : { address: parsed.supplier.address }) } });
  }
  const defaultCode = vendor.defaultExpenseAccountId ? ((await prisma.account.findUnique({ where: { id: vendor.defaultExpenseAccountId }, select: { code: true } }))?.code ?? null) : null;
  const account = await pickAccount(companyId, defaultCode, parsed);

  const aiExtraction = await prisma.aiExtraction.create({
    data: {
      companyId,
      sourceType: "INVOICE",
      rawResponse: { source: "PEPPOL", invoiceNumber: parsed.number, counterpartyName: parsed.supplier.name, registrationNumber: parsed.supplier.registrationNumber, totalAmount: parsed.total, accountReason: account.reason, notes: `デジタルインボイス(XML)から読み込みました。科目: ${account.reason}` },
      confidence: account.confidence,
      suggestedAccountCode: account.code,
      status: "NEEDS_REVIEW",
    },
  });
  const invoice = await prisma.invoice.create({
    data: {
      companyId,
      direction: "RECEIVED",
      status: "DRAFT",
      invoiceNumber: parsed.number,
      vendorId: vendor.id,
      issueDate: new Date(`${parsed.issueDate}T00:00:00Z`),
      dueDate: parsed.dueDate ? new Date(`${parsed.dueDate}T00:00:00Z`) : null,
      subtotalAmount: parsed.subtotal,
      taxAmount: parsed.tax,
      totalAmount: parsed.total,
      notes: [parsed.note, "デジタルインボイス(Peppol)"].filter(Boolean).join(" / ").slice(0, 500),
      sourceFileUrl: `data:application/xml;base64,${Buffer.from(xml, "utf8").toString("base64")}`,
      sourceSha256: sha,
      aiExtractionId: aiExtraction.id,
      lines: { create: parsed.lines.map((l, i) => ({ sortOrder: i, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, taxRate: l.taxRate, amount: l.amount })) },
    },
  });
  const { decision } = await postInvoiceJournal(invoice.id);
  const matchedOrder = await autoMatchImportedInvoice(companyId, invoice.id);
  return { invoiceId: invoice.id, vendor: parsed.supplier.name, number: parsed.number, total: parsed.total, registrationNumber: parsed.supplier.registrationNumber, account: account.code, accountReason: account.reason, decision, matchedOrder: !!matchedOrder };
}

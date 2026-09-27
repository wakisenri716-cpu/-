import { prisma } from "@/lib/prisma";
import type { BankTransaction } from "@prisma/client";
import { getAiProvider } from "@/lib/ai";
import { ensureAccount, ensureChartOfAccounts } from "@/lib/accounting/accounts";
import { evaluateAutomation } from "@/lib/accounting/automation";
import { recordInvoicePayment } from "@/lib/accounting/payments";
import { hasPayrollRuns } from "@/lib/shifts/service";
import type { StatementRow } from "./statement";
import { UserError } from "@/lib/errors";
import { createHash } from "crypto";
import { cardsWithKeyword, ensureBankAccounts, getBankAccount, matchesKeyword } from "./accounts";
const SETTLEABLE_INVOICE_STATUSES = ["CONFIRMED", "SENT", "PARTIALLY_PAID", "OVERDUE"] as const;

export class BankError extends UserError {}

type Suggestion = { accountCode: string; confidence: number; source: "RULE" | "HISTORY" | "AI"; reason: string };

// 銀行の摘要は半角カナ・全角英数が混ざるので、NFKCで全角カナ・半角英数にそろえてから照合する
function normalize(description: string): string {
  return description.normalize("NFKC").toUpperCase().replace(/\s+/g, " ").trim();
}

type Rule = { pattern: RegExp; out?: string; in?: string; confidence: number; reason: string };

// 摘要だけで科目がほぼ決まる取引。強いものは信頼度0.9(=初期の自動記帳ライン)にしている。
const RULES: Rule[] = [
  { pattern: /手数料|テスウリヨウ|テスウリョウ/, out: "5080", confidence: 0.95, reason: "摘要に「手数料」" },
  { pattern: /利息|リソク|利子/, out: "5150", in: "4020", confidence: 0.9, reason: "摘要に「利息」" },
  { pattern: /給与|給料|賞与|キユウヨ|キュウヨ|シヨウヨ|ショウヨ/, out: "5110", confidence: 0.9, reason: "摘要に「給与」" },
  { pattern: /社会保険|厚生年金|健康保険|労働保険|シヤカイホケン|シャカイホケン|ネンキン/, out: "5120", confidence: 0.9, reason: "社会保険料の引落し" },
  { pattern: /家賃|ヤチン|賃料|チンリヨウ|チンリョウ/, out: "5060", confidence: 0.9, reason: "摘要に「家賃」" },
  { pattern: /国税|地方税|住民税|事業税|法人税|消費税|固定資産税|自動車税|ゼイムシヨ|ゼイムショ/, out: "5140", confidence: 0.9, reason: "税金の納付" },
  { pattern: /電力|電気|デンキ|デンリヨク|デンリョク|ガス|水道|スイドウ/, out: "5070", confidence: 0.85, reason: "水道光熱費の引落し" },
  { pattern: /NTT|ドコモ|DOCOMO|KDDI|ソフトバンク|SOFTBANK|楽天モバイル|電話|インターネツト|インターネット/, out: "5040", confidence: 0.85, reason: "通信費の引落し" },
  { pattern: /GOOGLE ADS|広告|コウコク/, out: "5130", confidence: 0.8, reason: "摘要に「広告」" },
  { pattern: /AMAZON|アマゾン|ASKUL|アスクル|モノタロウ/, out: "5030", confidence: 0.75, reason: "通販での購入(消耗品の可能性が高い)" },
  { pattern: /JR|SUICA|スイカ|PASMO|パスモ|タクシー|ETC/, out: "5010", confidence: 0.75, reason: "交通機関の利用" },
];

function ruleSuggestion(row: BankTransaction, isCard = false): Suggestion | null {
  const text = normalize(row.description);
  // カードの返品・取消は、買ったときの費用を取り消すので「支払い」側のルールで判定する
  const refund = isCard && row.deposit > 0;
  const direction = row.withdrawal > 0 || refund ? "out" : "in";
  for (const rule of RULES) {
    const code = rule[direction];
    if (code && rule.pattern.test(text)) {
      return refund
        ? { accountCode: code, confidence: Math.min(rule.confidence, 0.75), source: "RULE", reason: `${rule.reason}の返品・取消` }
        : { accountCode: code, confidence: rule.confidence, source: "RULE", reason: rule.reason };
    }
  }
  return null;
}

// 過去に人が確定した(または自動記帳された)同じ摘要・同じ向きの明細があれば、その科目を使う
async function historySuggestion(row: BankTransaction, ownCode: string): Promise<Suggestion | null> {
  const direction = row.withdrawal > 0 ? { withdrawal: { gt: 0 } } : { deposit: { gt: 0 } };
  const previous = await prisma.bankTransaction.findFirst({
    where: {
      companyId: row.companyId,
      description: row.description,
      status: "POSTED",
      suggestedAccountCode: { not: null, notIn: [ownCode] },
      id: { not: row.id },
      ...direction,
    },
    orderBy: { date: "desc" },
  });
  if (!previous?.suggestedAccountCode) return null;
  return {
    accountCode: previous.suggestedAccountCode,
    confidence: 0.95,
    source: "HISTORY",
    reason: "過去に同じ摘要の明細をこの科目で記帳しています",
  };
}

// 残高と金額がちょうど一致する請求書が1件だけあれば、その請求書の入金・支払とみなして消込む
async function matchInvoice(row: BankTransaction) {
  const isDeposit = row.deposit > 0;
  const amount = isDeposit ? row.deposit : row.withdrawal;
  const invoices = await prisma.invoice.findMany({
    where: {
      companyId: row.companyId,
      direction: isDeposit ? "ISSUED" : "RECEIVED",
      status: { in: [...SETTLEABLE_INVOICE_STATUSES] },
      totalAmount: { gte: amount },
    },
    include: { payments: { select: { amount: true } } },
  });
  const candidates = invoices.filter(
    (inv) => inv.totalAmount - inv.payments.reduce((sum, p) => sum + p.amount, 0) === amount,
  );
  return candidates.length === 1 ? candidates[0] : null;
}

// 明細の口座・カード(own)と相手科目で仕訳を作る。
// 口座: 出金は「相手科目 / 普通預金(〇〇)」、入金は「普通預金(〇〇) / 相手科目」。
// カード: 利用は「相手科目 / 未払金(〇〇カード)」、返品・取消は「未払金(〇〇カード) / 相手科目」。
type Own = { code: string; name: string; kind: string };

async function ownAccountOf(row: BankTransaction): Promise<Own> {
  const bank = await getBankAccount(row.companyId, row.bankAccountId);
  return { code: bank.account.code, name: bank.name, kind: bank.kind };
}

async function postBankJournal(
  row: BankTransaction,
  accountCode: string,
  own: Own,
  options: { auto: boolean; suggestion?: Suggestion },
) {
  return prisma.$transaction(async (tx) => {
    const [bank, counter] = await Promise.all([
      ensureAccount(tx, row.companyId, own.code),
      ensureAccount(tx, row.companyId, accountCode),
    ]);
    const amount = row.withdrawal || row.deposit;
    const isCard = own.kind === "CARD";
    const lines =
      row.withdrawal > 0
        ? [
            { accountId: counter.id, debit: amount, credit: 0, memo: row.description },
            { accountId: bank.id, debit: 0, credit: amount, memo: isCard ? `${own.name} 利用` : `${own.name} 出金` },
          ]
        : [
            { accountId: bank.id, debit: amount, credit: 0, memo: isCard ? `${own.name} 返品・取消` : `${own.name} 入金` },
            { accountId: counter.id, debit: 0, credit: amount, memo: row.description },
          ];

    const entry = await tx.journalEntry.create({
      data: {
        companyId: row.companyId,
        date: row.date,
        description: `${isCard ? "カード明細" : "銀行明細"}(${own.name}): ${row.description}`,
        sourceType: "BANK",
        status: options.auto ? "AUTO_POSTED" : "POSTED_MANUALLY",
        createdByAi: true,
        lines: { create: lines },
      },
    });

    // 同じ明細を同時に確定しても仕訳が二重にならないよう、未処理のときだけ更新する
    const updated = await tx.bankTransaction.updateMany({
      where: { id: row.id, status: "PENDING", journalEntryId: null },
      data: {
        status: "POSTED",
        journalEntryId: entry.id,
        suggestedAccountCode: accountCode,
        ...(options.suggestion
          ? {
              confidence: options.suggestion.confidence,
              suggestionSource: options.suggestion.source,
              suggestionReason: options.suggestion.reason,
            }
          : { confidence: null, suggestionSource: "MANUAL", suggestionReason: "人が科目を選んで確定" }),
      },
    });
    if (updated.count !== 1) throw new BankError("この明細はすでに処理されています");
    return entry;
  });
}

export async function importBankStatement(companyId: string, rows: StatementRow[], bankAccountId?: string | null) {
  await ensureChartOfAccounts(companyId);
  const first = await ensureBankAccounts(companyId);
  const bank = await getBankAccount(companyId, bankAccountId);
  if (!bank.active) throw new BankError("しまった口座・カードには取り込めません");
  const own: Own = { code: bank.account.code, name: bank.name, kind: bank.kind };
  const isCard = bank.kind === "CARD";
  // 同じ内容の明細が別の口座にあっても重ならないよう、2つ目以降の口座は口座ごとの指紋にする
  // (最初の口座はこれまでと同じ指紋のままにして、前に取り込んだCSVを入れ直しても二重にならないようにする)
  const fingerprintOf = (fp: string) => (bank.id === first.id ? fp : createHash("sha256").update(`${bank.id}|${fp}`).digest("hex"));
  // createManyAndReturn は実際に作成した行だけを返すので、再アップロードした行や
  // 同時に別リクエストが作った行はここで処理されない
  const created = await prisma.bankTransaction.createManyAndReturn({
    data: rows.map((r) => ({ companyId, ...r, fingerprint: fingerprintOf(r.fingerprint), bankAccountId: bank.id })),
    skipDuplicates: true,
  });
  created.sort((a, b) => a.date.getTime() - b.date.getTime());

  const summary = { received: rows.length, imported: created.length, matched: 0, autoPosted: 0, pending: 0 };
  // シフトから給料を「給料手当/未払金」で計上している会社では、給与の振込は未払金の支払いになる
  const salaryAccrued = await hasPayrollRuns(companyId);
  const suggestions = new Map<string, Suggestion>();
  const needsAi: BankTransaction[] = [];
  // 銀行口座の明細で、カード代金の引落しを見分ける
  const cards = isCard ? [] : await cardsWithKeyword(companyId);

  for (const row of created) {
    // 請求書の消込は銀行口座の明細だけ(カードの利用は請求書の入金・支払ではない)
    const invoice = isCard ? null : await matchInvoice(row);
    if (invoice) {
      const { payment } = await recordInvoicePayment(invoice.id, row.deposit || row.withdrawal, row.date, own.code);
      await prisma.bankTransaction.update({
        where: { id: row.id },
        data: {
          status: "MATCHED",
          matchedInvoiceId: invoice.id,
          journalEntryId: payment.journalEntryId,
          confidence: 1,
          suggestionSource: "INVOICE",
          suggestionReason: `請求書 ${invoice.invoiceNumber ?? ""} の残高と金額が一致`,
        },
      });
      summary.matched++;
      continue;
    }
    const card = row.withdrawal > 0 ? cards.find((c) => matchesKeyword(row.description, c.keyword)) : undefined;
    let suggestion: Suggestion | null = card
      ? { accountCode: card.code, confidence: 0.95, source: "RULE", reason: `${card.name}の代金の引落し(摘要に「${card.keyword}」)` }
      : ((await historySuggestion(row, own.code)) ?? ruleSuggestion(row, isCard));
    if (suggestion?.source === "RULE" && suggestion.accountCode === "5110" && salaryAccrued) {
      suggestion = { ...suggestion, accountCode: "2020", reason: "給与の振込(シフトから計上済みの未払金の支払い)" };
    }
    if (suggestion) suggestions.set(row.id, suggestion);
    else needsAi.push(row);
  }

  if (needsAi.length > 0) {
    const accounts = await prisma.account.findMany({
      where: { companyId, code: { not: own.code }, hidden: false },
      orderBy: { code: "asc" },
      select: { code: true, name: true },
    });
    const allowed = new Set(accounts.map((a) => a.code));
    const results = await getAiProvider().classifyBankTransactions(
      needsAi.map((r) => ({
        description: r.description,
        direction: r.withdrawal > 0 ? "OUT" : "IN",
        amount: r.withdrawal || r.deposit,
      })),
      accounts,
    );
    needsAi.forEach((row, i) => {
      const r = results[i];
      const valid = r && allowed.has(r.accountCode);
      suggestions.set(row.id, {
        accountCode: valid ? r.accountCode : row.withdrawal > 0 || isCard ? "5990" : "4020",
        confidence: valid ? r.confidence : 0,
        source: "AI",
        reason: valid ? r.reason : "AIが判定できませんでした",
      });
    });
  }

  for (const row of created) {
    const suggestion = suggestions.get(row.id);
    if (!suggestion) continue;
    const decision = await evaluateAutomation(companyId, "BANK", suggestion.confidence, row.withdrawal || row.deposit);
    if (decision.auto) {
      await postBankJournal(row, suggestion.accountCode, own, { auto: true, suggestion });
      summary.autoPosted++;
    } else {
      await prisma.bankTransaction.update({
        where: { id: row.id },
        data: {
          suggestedAccountCode: suggestion.accountCode,
          confidence: suggestion.confidence,
          suggestionSource: suggestion.source,
          suggestionReason:
            suggestion.confidence < decision.minConfidence
              ? `${suggestion.reason}(信頼度が自動記帳の基準 ${Math.round(decision.minConfidence * 100)}% 未満のため確認待ち)`
              : `${suggestion.reason}(${decision.reason})`,
        },
      });
      summary.pending++;
    }
  }
  return summary;
}

async function findRow(companyId: string, id: string) {
  const row = await prisma.bankTransaction.findFirst({ where: { id, companyId } });
  if (!row) throw new BankError("明細が見つかりません");
  return row;
}

export async function confirmBankTransaction(companyId: string, id: string, accountId: string) {
  const row = await findRow(companyId, id);
  if (row.status !== "PENDING") throw new BankError("この明細はすでに処理されています");
  const account = await prisma.account.findFirst({ where: { id: accountId, companyId } });
  if (!account) throw new BankError("勘定科目を選択してください");
  const own = await ownAccountOf(row);
  if (account.code === own.code) throw new BankError(`「${account.name}」以外の相手科目を選択してください`);
  return postBankJournal(row, account.code, own, { auto: false });
}

export async function ignoreBankTransaction(companyId: string, id: string) {
  const row = await findRow(companyId, id);
  if (row.status !== "PENDING") throw new BankError("この明細はすでに処理されています");
  return prisma.bankTransaction.update({ where: { id }, data: { status: "IGNORED" } });
}

// 自動記帳の誤りを直せるよう、記帳済み・対象外の明細を未処理に戻す(仕訳は取消扱いにする)
export async function reopenBankTransaction(companyId: string, id: string) {
  const row = await findRow(companyId, id);
  if (row.status === "MATCHED") {
    throw new BankError("請求書と消込済みの明細は戻せません。請求書側の入金・支払記録を確認してください");
  }
  if (row.status === "PENDING") throw new BankError("この明細はまだ処理されていません");
  return prisma.$transaction(async (tx) => {
    if (row.journalEntryId) {
      await tx.journalEntry.update({ where: { id: row.journalEntryId }, data: { status: "VOID" } });
    }
    return tx.bankTransaction.update({ where: { id }, data: { status: "PENDING", journalEntryId: null } });
  });
}

export async function getBankTransactions(companyId: string, bankAccountId?: string | null) {
  const bank = await getBankAccount(companyId, bankAccountId);
  const [pending, processed, accounts] = await Promise.all([
    prisma.bankTransaction.findMany({ where: { companyId, bankAccountId: bank.id, status: "PENDING" }, orderBy: [{ date: "asc" }, { createdAt: "asc" }] }),
    prisma.bankTransaction.findMany({
      where: { companyId, bankAccountId: bank.id, status: { not: "PENDING" } },
      include: { matchedInvoice: { select: { invoiceNumber: true } } },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: 100,
    }),
    prisma.account.findMany({
      where: { companyId, code: { not: bank.account.code }, hidden: false },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true, category: true },
    }),
  ]);
  return { bankAccount: { id: bank.id, name: bank.name, kind: bank.kind, active: bank.active }, pending, processed, accounts };
}

import { EXPENSE_ACCOUNT_CODES } from "@/lib/accounting/chartOfAccounts";
import type {
  AiProvider,
  BankClassification,
  BankClassificationInput,
  InvoiceExtraction,
  ReceiptExtraction,
} from "./types";

// Deterministic, offline stand-in for the Claude vision provider so the app
// is runnable end-to-end without an API key (local dev, demos, tests).
// It fabricates plausible-looking fields from the input bytes instead of
// actually reading the image.

function hashToUnit(bytes: Uint8Array): number {
  let hash = 0;
  for (const byte of bytes) {
    hash = (hash * 31 + byte) >>> 0;
  }
  return hash / 0xffffffff;
}

const SAMPLE_VENDORS = ["株式会社サンプル商事", "みらいオフィス用品", "東京タクシー", "スターカフェ", "クラウド印刷"];

export class MockAiProvider implements AiProvider {
  async extractReceipt(input: { imageBase64: string; mediaType: string }): Promise<ReceiptExtraction> {
    const bytes = Buffer.from(input.imageBase64, "base64");
    const unit = hashToUnit(bytes.length ? bytes : Buffer.from(input.mediaType));
    const accountCode = EXPENSE_ACCOUNT_CODES[Math.floor(unit * EXPENSE_ACCOUNT_CODES.length)];
    const vendorName = SAMPLE_VENDORS[Math.floor(unit * SAMPLE_VENDORS.length)];
    const amount = 500 + Math.round(unit * 30000);
    const confidence = 0.6 + unit * 0.4; // 0.6-1.0, spans both auto and review paths

    return {
      vendorName,
      expenseDate: new Date().toISOString().slice(0, 10),
      amount,
      description: `${vendorName}での支払い(モック抽出)`,
      suggestedAccountCode: accountCode,
      confidence: Number(confidence.toFixed(2)),
      notes: "ANTHROPIC_API_KEY 未設定のためモック抽出結果です。",
    };
  }

  async extractInvoice(input: {
    imageBase64: string;
    mediaType: string;
    direction: "ISSUED" | "RECEIVED";
  }): Promise<InvoiceExtraction> {
    const bytes = Buffer.from(input.imageBase64, "base64");
    const unit = hashToUnit(bytes.length ? bytes : Buffer.from(input.mediaType));
    const subtotal = 10000 + Math.round(unit * 200000);
    const tax = Math.round(subtotal * 0.1);
    const counterpartyName = SAMPLE_VENDORS[Math.floor(unit * SAMPLE_VENDORS.length)];
    const accountCode =
      input.direction === "RECEIVED"
        ? EXPENSE_ACCOUNT_CODES[Math.floor(unit * EXPENSE_ACCOUNT_CODES.length)]
        : "4010";

    return {
      counterpartyName,
      invoiceNumber: `T${Math.floor(unit * 900000000) + 100000000}`,
      issueDate: new Date().toISOString().slice(0, 10),
      dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      subtotalAmount: subtotal,
      taxAmount: tax,
      totalAmount: subtotal + tax,
      suggestedAccountCode: accountCode,
      confidence: Number((0.6 + unit * 0.4).toFixed(2)),
      notes: "ANTHROPIC_API_KEY 未設定のためモック抽出結果です。",
    };
  }

  // キーワードルールで判定できなかった明細だけがここに来る。モックでは推測せず、
  // 低い信頼度で雑費/雑収入を提案して必ず人の確認に回す。
  async classifyBankTransactions(items: BankClassificationInput[]): Promise<BankClassification[]> {
    return items.map((item) => ({
      accountCode: item.direction === "OUT" ? "5990" : "4020",
      confidence: 0.3,
      reason: "ANTHROPIC_API_KEY 未設定のため判定できませんでした(モック)",
    }));
  }
}

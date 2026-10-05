export type ReceiptExtraction = {
  vendorName: string | null;
  expenseDate: string | null; // ISO date
  amount: number | null;
  description: string;
  suggestedAccountCode: string;
  confidence: number; // 0..1
  notes?: string;
};

export type InvoiceExtraction = {
  counterpartyName: string | null;
  invoiceNumber: string | null;
  issueDate: string | null;
  dueDate: string | null;
  subtotalAmount: number | null;
  taxAmount: number | null;
  totalAmount: number | null;
  suggestedAccountCode: string;
  confidence: number;
  notes?: string;
};

export type BankClassificationInput = { description: string; direction: "IN" | "OUT"; amount: number };

export type BankClassification = { accountCode: string; confidence: number; reason: string };

// AI受付箱: どんな書類かを見分けた結果
export type DocumentKind = "RECEIVED_INVOICE" | "RECEIPT" | "CONTRACT" | "OTHER";
export type DocumentClassification = {
  kind: DocumentKind;
  title: string; // 書類の名前(例: 業務委託契約書、〇〇からの請求書)
  counterparty: string | null; // 相手の名前
  documentDate: string | null; // 書類の日付 YYYY-MM-DD
  amount: number | null; // 金額(税込・円)
  endDate: string | null; // 契約の満了日・更新日など YYYY-MM-DD
  summary: string; // 1〜2文の要約(日本語)
  confidence: number;
};

export interface AiProvider {
  classifyDocument(input: { base64: string; mediaType: string; fileName: string }): Promise<DocumentClassification>;
  extractReceipt(input: { imageBase64: string; mediaType: string }): Promise<ReceiptExtraction>;
  extractInvoice(input: {
    imageBase64: string;
    mediaType: string;
    direction: "ISSUED" | "RECEIVED";
  }): Promise<InvoiceExtraction>;
  classifyBankTransactions(
    items: BankClassificationInput[],
    accounts: { code: string; name: string }[],
  ): Promise<BankClassification[]>;
}

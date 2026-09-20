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

export interface AiProvider {
  extractReceipt(input: { imageBase64: string; mediaType: string }): Promise<ReceiptExtraction>;
  extractInvoice(input: {
    imageBase64: string;
    mediaType: string;
    direction: "ISSUED" | "RECEIVED";
  }): Promise<InvoiceExtraction>;
}

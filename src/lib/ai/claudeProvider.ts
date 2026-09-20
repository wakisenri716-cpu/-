import Anthropic from "@anthropic-ai/sdk";
import { EXPENSE_ACCOUNT_CODES } from "@/lib/accounting/chartOfAccounts";
import type { AiProvider, InvoiceExtraction, ReceiptExtraction } from "./types";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

function client() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

const receiptTool: Anthropic.Tool = {
  name: "record_receipt_extraction",
  description: "Record structured data extracted from a receipt image for expense reimbursement.",
  input_schema: {
    type: "object",
    properties: {
      vendorName: { type: ["string", "null"], description: "Store or vendor name on the receipt" },
      expenseDate: { type: ["string", "null"], description: "Date on the receipt, ISO 8601 (YYYY-MM-DD)" },
      amount: { type: ["number", "null"], description: "Total amount paid, tax included, as an integer in JPY" },
      description: { type: "string", description: "Short one-line description of the expense in Japanese" },
      suggestedAccountCode: {
        type: "string",
        enum: EXPENSE_ACCOUNT_CODES,
        description: "Best-matching expense account code from the chart of accounts",
      },
      confidence: {
        type: "number",
        description: "Confidence 0.0-1.0 that the extracted fields and account code are correct",
      },
      notes: { type: "string", description: "Anything ambiguous or that needs human review" },
    },
    required: ["vendorName", "expenseDate", "amount", "description", "suggestedAccountCode", "confidence"],
  },
};

const invoiceTool: Anthropic.Tool = {
  name: "record_invoice_extraction",
  description: "Record structured data extracted from an invoice document image.",
  input_schema: {
    type: "object",
    properties: {
      counterpartyName: { type: ["string", "null"], description: "Vendor name (for received) or customer name (for issued)" },
      invoiceNumber: { type: ["string", "null"] },
      issueDate: { type: ["string", "null"], description: "ISO 8601 date" },
      dueDate: { type: ["string", "null"], description: "ISO 8601 date" },
      subtotalAmount: { type: ["number", "null"], description: "Amount before tax, integer JPY" },
      taxAmount: { type: ["number", "null"], description: "Consumption tax amount, integer JPY" },
      totalAmount: { type: ["number", "null"], description: "Total amount including tax, integer JPY" },
      suggestedAccountCode: {
        type: "string",
        enum: EXPENSE_ACCOUNT_CODES,
        description: "For a received invoice, the best-matching expense account code. For an issued invoice, use 4010.",
      },
      confidence: { type: "number", description: "Confidence 0.0-1.0" },
      notes: { type: "string" },
    },
    required: [
      "counterpartyName",
      "invoiceNumber",
      "issueDate",
      "dueDate",
      "subtotalAmount",
      "taxAmount",
      "totalAmount",
      "suggestedAccountCode",
      "confidence",
    ],
  },
};

function extractToolInput<T>(message: Anthropic.Message, toolName: string): T {
  const toolUse = message.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use" && block.name === toolName,
  );
  if (!toolUse) {
    throw new Error(`AI response did not call ${toolName}`);
  }
  return toolUse.input as T;
}

export class ClaudeAiProvider implements AiProvider {
  async extractReceipt(input: { imageBase64: string; mediaType: string }): Promise<ReceiptExtraction> {
    const message = await client().messages.create({
      model: MODEL,
      max_tokens: 1024,
      tools: [receiptTool],
      tool_choice: { type: "tool", name: receiptTool.name },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: input.mediaType as "image/jpeg" | "image/png" | "image/webp" | "image/gif",
                data: input.imageBase64,
              },
            },
            {
              type: "text",
              text: "この領収書/レシート画像から経費精算に必要な情報を抽出し、record_receipt_extraction ツールで報告してください。金額は税込の整数円で。勘定科目は選択肢から最も適切なものを選んでください。読み取りにくい・判断に迷う場合は confidence を低くしてください。",
            },
          ],
        },
      ],
    });
    return extractToolInput<ReceiptExtraction>(message, receiptTool.name);
  }

  async extractInvoice(input: {
    imageBase64: string;
    mediaType: string;
    direction: "ISSUED" | "RECEIVED";
  }): Promise<InvoiceExtraction> {
    const directionHint =
      input.direction === "RECEIVED"
        ? "これは自社が受け取った請求書(仕入・経費側)です。counterpartyName には請求元(取引先)の名前を入れてください。"
        : "これは自社が発行した請求書(売上側)です。counterpartyName には請求先(顧客)の名前を入れ、suggestedAccountCode は 4010 (売上高) にしてください。";

    const message = await client().messages.create({
      model: MODEL,
      max_tokens: 1024,
      tools: [invoiceTool],
      tool_choice: { type: "tool", name: invoiceTool.name },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: input.mediaType as "image/jpeg" | "image/png" | "image/webp" | "image/gif",
                data: input.imageBase64,
              },
            },
            {
              type: "text",
              text: `この請求書画像から情報を抽出し、record_invoice_extraction ツールで報告してください。${directionHint} 金額はすべて整数円で。読み取りにくい・判断に迷う場合は confidence を低くしてください。`,
            },
          ],
        },
      ],
    });
    return extractToolInput<InvoiceExtraction>(message, invoiceTool.name);
  }
}

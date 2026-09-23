import Anthropic from "@anthropic-ai/sdk";
import { EXPENSE_ACCOUNT_CODES } from "@/lib/accounting/chartOfAccounts";
import type {
  AiProvider,
  BankClassification,
  BankClassificationInput,
  InvoiceExtraction,
  ReceiptExtraction,
} from "./types";

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

const BANK_BATCH_SIZE = 50;

function bankClassificationTool(accountCodes: string[]): Anthropic.Tool {
  return {
    name: "record_bank_classifications",
    description: "Record the account classification for each bank statement line.",
    input_schema: {
      type: "object",
      properties: {
        results: {
          type: "array",
          items: {
            type: "object",
            properties: {
              index: { type: "integer", description: "Index of the statement line in the input list" },
              accountCode: { type: "string", enum: accountCodes, description: "Counter account code for this line" },
              confidence: { type: "number", description: "Confidence 0.0-1.0 that the account code is correct" },
              reason: { type: "string", description: "One short sentence in Japanese explaining the choice" },
            },
            required: ["index", "accountCode", "confidence", "reason"],
          },
        },
      },
      required: ["results"],
    },
  };
}

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

  async classifyBankTransactions(
    items: BankClassificationInput[],
    accounts: { code: string; name: string }[],
  ): Promise<BankClassification[]> {
    const tool = bankClassificationTool(accounts.map((a) => a.code));
    const accountList = accounts.map((a) => `${a.code} ${a.name}`).join("\n");
    const results: BankClassification[] = [];

    for (let start = 0; start < items.length; start += BANK_BATCH_SIZE) {
      const batch = items.slice(start, start + BANK_BATCH_SIZE);
      const lines = batch
        .map((item, i) => `${i}\t${item.direction === "OUT" ? "出金" : "入金"}\t${item.amount}円\t${item.description}`)
        .join("\n");

      const message = await client().messages.create({
        model: MODEL,
        max_tokens: 8000,
        tools: [tool],
        tool_choice: { type: "tool", name: tool.name },
        messages: [
          {
            role: "user",
            content: `日本の中小企業の普通預金口座の明細です。各行について、普通預金の相手勘定として最も適切な勘定科目を選び、record_bank_classifications ツールで全行分を報告してください。摘要は銀行の半角カナ表記(例: ﾌﾘｺﾐ、ｶ)=株式会社)のことがあります。摘要だけでは判断できない行は confidence を0.5未満にしてください。\n\n勘定科目:\n${accountList}\n\n明細(番号\t区分\t金額\t摘要):\n${lines}`,
          },
        ],
      });
      const { results: batchResults } = extractToolInput<{
        results: { index: number; accountCode: string; confidence: number; reason: string }[];
      }>(message, tool.name);

      const byIndex = new Map(batchResults.map((r) => [r.index, r]));
      batch.forEach((item, i) => {
        const r = byIndex.get(i);
        results.push(
          r
            ? { accountCode: r.accountCode, confidence: Math.max(0, Math.min(1, r.confidence)), reason: r.reason }
            : { accountCode: item.direction === "OUT" ? "5990" : "4020", confidence: 0, reason: "AIの回答にこの行が含まれていませんでした" },
        );
      });
    }
    return results;
  }
}

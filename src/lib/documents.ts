import { prisma } from "@/lib/prisma";

// 電子帳簿保存法の検索要件(取引年月日・取引金額・取引先で検索でき、日付と金額は範囲指定、2つ以上の組み合わせ)に沿った証憑検索
export type DocumentKind = "receipt" | "received" | "issued";
export type DocumentQuery = { from?: string; to?: string; min?: string; max?: string; party?: string; kind?: string };

export const KIND_LABELS: Record<DocumentKind, string> = { receipt: "領収書(経費)", received: "受領請求書", issued: "発行請求書" };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const LIMIT = 300;

export type DocumentRow = {
  kind: DocumentKind;
  id: string;
  date: string | null;
  party: string | null;
  amount: number;
  description: string;
  hasFile: boolean;
  href: string | null;
};

function parse(q: DocumentQuery) {
  const from = q.from && DATE.test(q.from) ? new Date(`${q.from}T00:00:00Z`) : undefined;
  const to = q.to && DATE.test(q.to) ? new Date(Date.parse(`${q.to}T00:00:00Z`) + 86_400_000) : undefined;
  const min = q.min && /^\d+$/.test(q.min) ? Number(q.min) : undefined;
  const max = q.max && /^\d+$/.test(q.max) ? Number(q.max) : undefined;
  const party = q.party?.trim() || undefined;
  const kind = (["receipt", "received", "issued"] as const).find((k) => k === q.kind);
  return { from, to, min, max, party, kind };
}

export async function searchDocuments(companyId: string, query: DocumentQuery) {
  const { from, to, min, max, party, kind } = parse(query);
  const dateRange = from || to ? { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } : undefined;
  const amountRange = min !== undefined || max !== undefined ? { ...(min !== undefined ? { gte: min } : {}), ...(max !== undefined ? { lte: max } : {}) } : undefined;
  const nameFilter = party ? { name: { contains: party, mode: "insensitive" as const } } : undefined;

  const [receipts, invoices] = await Promise.all([
    !kind || kind === "receipt"
      ? prisma.expenseItem.findMany({
          where: {
            expenseReport: { companyId },
            ...(dateRange ? { expenseDate: dateRange } : {}),
            ...(amountRange ? { amount: amountRange } : {}),
            ...(nameFilter ? { vendor: nameFilter } : {}),
          },
          select: { id: true, expenseDate: true, amount: true, description: true, vendor: { select: { name: true } }, receiptImageUrl: true },
          orderBy: { expenseDate: "desc" },
          take: LIMIT,
        })
      : [],
    !kind || kind !== "receipt"
      ? prisma.invoice.findMany({
          where: {
            companyId,
            ...(kind ? { direction: kind === "issued" ? "ISSUED" : "RECEIVED" } : {}),
            ...(dateRange ? { issueDate: dateRange } : {}),
            ...(amountRange ? { totalAmount: amountRange } : {}),
            ...(nameFilter ? { OR: [{ vendor: nameFilter }, { customer: nameFilter }] } : {}),
          },
          select: {
            id: true,
            direction: true,
            invoiceNumber: true,
            issueDate: true,
            totalAmount: true,
            status: true,
            vendor: { select: { name: true } },
            customer: { select: { name: true } },
            sourceFileUrl: true,
            _count: { select: { lines: true } },
          },
          orderBy: { issueDate: "desc" },
          take: LIMIT,
        })
      : [],
  ]);

  const rows: DocumentRow[] = [
    ...receipts.map((r) => ({
      kind: "receipt" as const,
      id: r.id,
      date: r.expenseDate.toISOString().slice(0, 10),
      party: r.vendor?.name ?? null,
      amount: r.amount,
      description: r.description,
      hasFile: !!r.receiptImageUrl,
      href: r.receiptImageUrl ? `/api/documents/file?kind=receipt&id=${r.id}` : null,
    })),
    ...invoices.map((i) => ({
      kind: i.direction === "ISSUED" ? ("issued" as const) : ("received" as const),
      id: i.id,
      date: i.issueDate ? i.issueDate.toISOString().slice(0, 10) : null,
      party: (i.direction === "ISSUED" ? i.customer?.name : i.vendor?.name) ?? null,
      amount: i.totalAmount,
      description: `${i.invoiceNumber ?? "(番号なし)"}${i.status === "CANCELLED" ? "(取消)" : ""}`,
      hasFile: !!i.sourceFileUrl || i._count.lines > 0,
      href: i.sourceFileUrl ? `/api/documents/file?kind=invoice&id=${i.id}` : i._count.lines > 0 ? `/invoices/${i.id}/print` : null,
    })),
  ].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));

  return { rows: rows.slice(0, LIMIT), truncated: rows.length > LIMIT || receipts.length === LIMIT || invoices.length === LIMIT };
}

// DBに data URI で保存している画像を取り出す
export async function getDocumentFile(companyId: string, kind: string, id: string) {
  const uri =
    kind === "receipt"
      ? (await prisma.expenseItem.findFirst({ where: { id, expenseReport: { companyId } }, select: { receiptImageUrl: true } }))?.receiptImageUrl
      : kind === "invoice"
        ? (await prisma.invoice.findFirst({ where: { id, companyId }, select: { sourceFileUrl: true } }))?.sourceFileUrl
        : null;
  const match = uri?.match(/^data:([\w.+-]+\/[\w.+-]+);base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) return null;
  return { mediaType: match[1], body: Buffer.from(match[2], "base64") };
}

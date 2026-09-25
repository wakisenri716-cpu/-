import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireCompanyId } from "@/lib/auth/session";
import {
  correctionNumber,
  getPrintableInvoice,
  toFormLines,
} from "@/lib/accounting/issueInvoice";
import { BillingForm } from "@/components/BillingForm";

export const dynamic = "force-dynamic";

const key = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : undefined);

// ?from=請求書ID で、その請求書の宛先・明細を写した状態から作り始める(毎月同じ請求の複製)
// ?correct=請求書ID で、その請求書の訂正版を作る(日付・部門もそのまま入れておく)
export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; correct?: string }>;
}) {
  const companyId = await requireCompanyId();
  const { from, correct } = await searchParams;
  const source = correct
    ? await getPrintableInvoice(companyId, correct)
    : from
      ? await getPrintableInvoice(companyId, from)
      : null;
  if (correct && (!source || source.invoice.status === "CANCELLED")) notFound();
  const department =
    correct && source?.invoice.journalEntryId
      ? (
          await prisma.journalEntry.findUnique({
            where: { id: source.invoice.journalEntryId },
            select: { departmentId: true },
          })
        )?.departmentId
      : null;
  const initial = source
    ? {
        customerName: source.invoice.customer?.name ?? "",
        lines: toFormLines(source.invoice.lines),
        notes: source.invoice.notes ?? "",
        ...(correct
          ? {
              issueDate: key(source.invoice.issueDate),
              dueDate: key(source.invoice.dueDate),
              departmentId: department ?? null,
            }
          : {}),
      }
    : null;
  const correction =
    correct && source
      ? {
          id: source.invoice.id,
          number: source.invoice.invoiceNumber ?? "",
          nextNumber: correctionNumber(source.invoice.invoiceNumber ?? ""),
          paid: source.invoice.payments.reduce((s, p) => s + p.amount, 0),
        }
      : null;
  return (
    <BillingForm kind="invoice" initial={initial} correction={correction} />
  );
}

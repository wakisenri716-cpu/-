import type { RecurringInput } from "@/lib/accounting/recurring";

export function parseRecurringBody(body: Record<string, unknown>): RecurringInput {
  const lines = Array.isArray(body.lines) ? body.lines : [];
  return {
    name: String(body.name ?? ""),
    description: String(body.description ?? ""),
    dayOfMonth: Number(body.dayOfMonth),
    startMonth: String(body.startMonth ?? ""),
    endMonth: body.endMonth ? String(body.endMonth) : null,
    lines: lines.map((l: Record<string, unknown>) => ({
      accountId: String(l?.accountId ?? ""),
      debit: Number(l?.debit || 0),
      credit: Number(l?.credit || 0),
    })),
  };
}

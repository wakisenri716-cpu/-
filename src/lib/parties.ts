import { prisma } from "@/lib/prisma";

const OPEN = new Set(["CONFIRMED", "SENT", "PARTIALLY_PAID", "OVERDUE"]);

// 取引先(仕入・経費の相手)・顧客(売上の相手)ごとの取引の履歴と残高
export async function getPartyDetail(companyId: string, kind: "vendor" | "customer", id: string) {
  const party =
    kind === "vendor"
      ? await prisma.vendor.findFirst({ where: { id, companyId }, include: { defaultExpenseAccount: { select: { code: true, name: true } } } })
      : await prisma.customer.findFirst({ where: { id, companyId } });
  if (!party) return null;

  const [invoices, quotes, expenses] = await Promise.all([
    prisma.invoice.findMany({
      where: { companyId, ...(kind === "vendor" ? { vendorId: id } : { customerId: id }) },
      include: { payments: { select: { amount: true } }, _count: { select: { lines: true } } },
      orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
    }),
    kind === "customer" ? prisma.quote.findMany({ where: { companyId, customerId: id }, orderBy: { issueDate: "desc" } }) : Promise.resolve([]),
    kind === "vendor"
      ? prisma.expenseItem.findMany({
          where: { vendorId: id, expenseReport: { companyId } },
          include: { account: { select: { code: true, name: true } }, expenseReport: { select: { employee: { select: { name: true } } } } },
          orderBy: { expenseDate: "desc" },
          take: 100,
        })
      : Promise.resolve([]),
  ]);

  const rows = invoices.map((i) => {
    const paid = i.payments.reduce((s, p) => s + p.amount, 0);
    return {
      id: i.id,
      invoiceNumber: i.invoiceNumber,
      issueDate: i.issueDate,
      dueDate: i.dueDate,
      status: i.status,
      total: i.totalAmount,
      paid,
      remaining: OPEN.has(i.status) ? i.totalAmount - paid : 0,
      printable: i._count.lines > 0,
    };
  });
  const active = rows.filter((r) => r.status !== "CANCELLED" && r.status !== "PENDING_REVIEW" && r.status !== "DRAFT");
  return {
    kind,
    party: {
      id: party.id,
      name: party.name,
      defaultAccount: "defaultExpenseAccount" in party ? (party.defaultExpenseAccount as { code: string; name: string } | null) : null,
    },
    invoices: rows,
    quotes,
    expenses,
    totals: {
      invoiced: active.reduce((s, r) => s + r.total, 0),
      settled: active.reduce((s, r) => s + r.paid, 0),
      remaining: active.reduce((s, r) => s + r.remaining, 0),
      expenses: expenses.reduce((s, e) => s + e.amount, 0),
    },
  };
}

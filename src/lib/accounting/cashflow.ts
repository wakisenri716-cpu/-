import { prisma } from "@/lib/prisma";
import { jstDateKey } from "@/lib/jst";
import { getAging } from "./receivables";
import { getReimbursements } from "./reimbursement";
import { listRecurring, postingDate } from "./recurring";
import { cashAccountCodes } from "@/lib/bank/accounts";

const POSTED = ["AUTO_POSTED", "POSTED_MANUALLY"] as const;

export type CashItem = { label: string; amount: number; note?: string };
export type CashMonth = { month: string; opening: number; inflows: CashItem[]; outflows: CashItem[]; inflow: number; outflow: number; closing: number };

function addMonths(month: string, n: number) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

// 資金繰り予測: 今日の現預金残高から、入金予定(売掛金)・支払予定(買掛金)・定期取引・立替経費の精算を月ごとに足し引きする。
// 期日を過ぎた入金・支払や、記帳日が来ているのに未記帳の定期取引は「今月」に入れる。
export async function getCashflow(companyId: string, today = jstDateKey(new Date()), monthCount = 3) {
  const current = today.slice(0, 7);
  const months = Array.from({ length: monthCount }, (_, i) => addMonths(current, i));
  const bucket = (date: string | null) => {
    const m = date ? date.slice(0, 7) : current;
    return m < current ? current : m;
  };

  // 現金・普通預金と、登録した銀行口座
  const CASH_CODES = await cashAccountCodes(companyId);
  const [cash, receivables, payables, recurring, reimbursements] = await Promise.all([
    prisma.journalLine.aggregate({
      where: {
        account: { companyId, code: { in: CASH_CODES } },
        journalEntry: { companyId, status: { in: [...POSTED] }, date: { lt: new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000) } },
      },
      _sum: { debit: true, credit: true },
    }),
    getAging(companyId, "ISSUED", today),
    getAging(companyId, "RECEIVED", today),
    listRecurring(companyId, today),
    getReimbursements(companyId),
  ]);
  const cashCodeOf = new Map((await prisma.account.findMany({ where: { companyId, code: { in: CASH_CODES } }, select: { id: true } })).map((a) => [a.id, true]));

  const inflows = new Map<string, CashItem[]>(months.map((m) => [m, []]));
  const outflows = new Map<string, CashItem[]>(months.map((m) => [m, []]));
  const push = (map: Map<string, CashItem[]>, month: string, item: CashItem) => map.get(month)?.push(item);

  for (const r of receivables.rows) {
    push(inflows, bucket(r.dueDate), { label: `${r.partyName} ${r.invoiceNumber ?? ""}`.trim(), amount: r.remaining, note: r.overdueDays > 0 ? `期日超過${r.overdueDays}日` : undefined });
  }
  for (const r of payables.rows) {
    push(outflows, bucket(r.dueDate), { label: `${r.partyName} ${r.invoiceNumber ?? ""}`.trim(), amount: r.remaining, note: r.overdueDays > 0 ? `期日超過${r.overdueDays}日` : undefined });
  }

  // 定期取引は、現金・普通預金の行の増減だけを資金の動きとして数える
  for (const e of recurring) {
    if (!e.active) continue;
    const net = e.lines.reduce((s, l) => (cashCodeOf.has(l.accountId) ? s + l.debit - l.credit : s), 0);
    if (net === 0) continue;
    const future = months.filter((m) => {
      const date = postingDate(m, e.dayOfMonth);
      return date > today && m >= e.startMonth && (!e.endMonth || m <= e.endMonth);
    });
    for (const m of [...e.due.map(() => current), ...future]) {
      push(net > 0 ? inflows : outflows, m, { label: `${e.name}(定期取引)`, amount: Math.abs(net), note: e.due.length && m === current ? "記帳日が来ています" : undefined });
    }
  }

  const reimburse = reimbursements.filter((r) => r.state === "READY");
  if (reimburse.length) {
    push(outflows, current, { label: `立替経費の精算(${reimburse.length}件)`, amount: reimburse.reduce((s, r) => s + r.amount, 0) });
  }

  let balance = (cash._sum.debit ?? 0) - (cash._sum.credit ?? 0);
  const result: CashMonth[] = months.map((month) => {
    const ins = inflows.get(month)!;
    const outs = outflows.get(month)!;
    const inflow = ins.reduce((s, i) => s + i.amount, 0);
    const outflow = outs.reduce((s, i) => s + i.amount, 0);
    const opening = balance;
    balance = opening + inflow - outflow;
    return { month, opening, inflows: ins, outflows: outs, inflow, outflow, closing: balance };
  });
  return { today, months: result, shortage: result.find((m) => m.closing < 0)?.month ?? null };
}

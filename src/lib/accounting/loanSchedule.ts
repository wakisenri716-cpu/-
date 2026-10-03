// 借入金の返済予定表の計算(データベースには触らないので、画面でも同じ計算を使える)。
// 利息は「残高 × 年利 ÷ 12」(円未満切捨て)の月割りの目安。銀行の予定表(日割り)と違うときは、記帳のときに実際の額を入れてもらう。

export type LoanMethod = "EQUAL_PAYMENT" | "EQUAL_PRINCIPAL";
export type LoanTerms = { principal: number; annualRate: number; months: number; method: LoanMethod; firstPaymentMonth: string; paymentDay: number };
export type PaidRow = { month: string; principal: number; interest: number };
export type ScheduleRow = { no: number; month: string; date: string; principal: number; interest: number; total: number; balance: number; posted: boolean };

export const METHOD_LABEL: Record<LoanMethod, string> = { EQUAL_PAYMENT: "元利均等(毎月の返済額が同じ)", EQUAL_PRINCIPAL: "元金均等(毎月の元金が同じ)" };

export function addMonths(month: string, n: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// 返済日(月末より後の日は月末)
export function paymentDate(month: string, day: number) {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(Math.min(day, last)).padStart(2, "0")}`;
}

// 年利(0.001%単位)を月利に
const monthlyRate = (annualRate: number) => annualRate / 100_000 / 12;

// 記帳した月は実際の額、まだの月は今の残高から計算し直した額で予定表を作る
export function buildSchedule(terms: LoanTerms, paid: PaidRow[] = []): ScheduleRow[] {
  const r = monthlyRate(terms.annualRate);
  const paidBy = new Map(paid.map((p) => [p.month, p]));
  let balance = terms.principal;
  const rows: ScheduleRow[] = [];
  for (let i = 0; i < terms.months; i++) {
    const month = addMonths(terms.firstPaymentMonth, i);
    const actual = paidBy.get(month);
    let principal: number;
    let interest: number;
    if (actual) {
      principal = actual.principal;
      interest = actual.interest;
    } else {
      const left = terms.months - i;
      interest = Math.floor(balance * r);
      if (left === 1) principal = balance;
      else if (terms.method === "EQUAL_PRINCIPAL") principal = Math.floor(balance / left);
      else {
        const payment = r === 0 ? balance / left : (balance * r) / (1 - Math.pow(1 + r, -left));
        principal = Math.min(balance, Math.max(0, Math.round(payment) - interest));
      }
    }
    balance -= principal;
    rows.push({ no: i + 1, month, date: paymentDate(month, terms.paymentDay), principal, interest, total: principal + interest, balance, posted: !!actual });
  }
  return rows;
}

export function formatRate(annualRate: number) {
  return `${(annualRate / 1000).toFixed(3).replace(/\.?0+$/, "")}%`;
}

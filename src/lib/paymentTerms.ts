import { closedReason, nextBusinessDay, prevBusinessDay } from "@/lib/holidays";

// 顧客ごとの支払条件(締め日・支払日)。画面とサーバーの両方で使う。
// closingDay: 締め日(0=月末、1〜28) / payMonths: 何か月後(0〜3) / payDay: 支払日(0=月末、1〜31) / holidayRule: 支払日が銀行の休業日のとき next=翌営業日・prev=前営業日・none=そのまま
export type PaymentTerms = {
  closingDay: number;
  payMonths: number;
  payDay: number;
  holidayRule: "next" | "prev" | "none";
};

export const DEFAULT_TERMS: PaymentTerms = {
  closingDay: 0,
  payMonths: 1,
  payDay: 0,
  holidayRule: "none",
};

const lastDay = (y: number, m: number) =>
  new Date(Date.UTC(y, m, 0)).getUTCDate();
const pad = (n: number) => String(n).padStart(2, "0");

export function readTerms(
  v:
    | {
        closingDay?: number | null;
        payMonths?: number | null;
        payDay?: number | null;
        holidayRule?: string | null;
      }
    | null
    | undefined,
): PaymentTerms | null {
  if (
    !v ||
    v.closingDay === null ||
    v.closingDay === undefined ||
    v.payMonths === null ||
    v.payMonths === undefined ||
    v.payDay === null ||
    v.payDay === undefined
  )
    return null;
  return {
    closingDay: v.closingDay,
    payMonths: v.payMonths,
    payDay: v.payDay,
    holidayRule:
      v.holidayRule === "next" || v.holidayRule === "prev"
        ? v.holidayRule
        : "none",
  };
}

export function validTerms(t: PaymentTerms) {
  return (
    Number.isInteger(t.closingDay) &&
    t.closingDay >= 0 &&
    t.closingDay <= 28 &&
    Number.isInteger(t.payMonths) &&
    t.payMonths >= 0 &&
    t.payMonths <= 3 &&
    Number.isInteger(t.payDay) &&
    t.payDay >= 0 &&
    t.payDay <= 31
  );
}

const dayLabel = (d: number) => (d === 0 ? "末" : `${d}日`);
const MONTHS = ["当月", "翌月", "翌々月", "3か月後の"];

// 「月末締め翌月末払い(休日は翌営業日)」
export function termsLabel(t: PaymentTerms) {
  return `${t.closingDay === 0 ? "月末" : `${t.closingDay}日`}締め${MONTHS[t.payMonths]}${dayLabel(t.payDay)}払い${t.holidayRule === "next" ? "(休日は翌営業日)" : t.holidayRule === "prev" ? "(休日は前営業日)" : ""}`;
}

// 請求日(取引の日)から支払期限を出す。締め日を過ぎた分は翌月の締めに入る
export function dueDateFor(t: PaymentTerms, issueDate: string) {
  let [y, m] = issueDate.split("-").map(Number);
  const d = Number(issueDate.slice(8, 10));
  const closing = t.closingDay === 0 ? lastDay(y, m) : t.closingDay;
  if (d > closing) m += 1; // 締め日を過ぎた → 翌月締め
  m += t.payMonths;
  y += Math.floor((m - 1) / 12);
  m = ((m - 1) % 12) + 1;
  const day =
    t.payDay === 0 ? lastDay(y, m) : Math.min(t.payDay, lastDay(y, m));
  let due = `${y}-${pad(m)}-${pad(day)}`;
  if (t.holidayRule !== "none" && closedReason(due, "bank"))
    due =
      t.holidayRule === "next"
        ? nextBusinessDay(due, "bank")
        : prevBusinessDay(due, "bank");
  return due;
}

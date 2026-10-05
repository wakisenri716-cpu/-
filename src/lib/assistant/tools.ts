import type Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { jstDateKey } from "@/lib/jst";
import { getIncomeStatement } from "@/lib/accounting/incomeStatement";
import { getAccountBalances } from "@/lib/accounting/ledger";
import { getAging } from "@/lib/accounting/receivables";
import { getJournalBook } from "@/lib/accounting/journal";
import { getSalesAnalysis } from "@/lib/accounting/salesAnalysis";
import { getBudgetProgress } from "@/lib/accounting/budgetProgress";
import { getCashBalance, getTodos } from "@/lib/dashboard";
import { getFiscalStartMonth, nextDay, resolvePeriod, toRange } from "@/lib/accounting/period";
import { proposeInvoice, proposeJournal, proposeReminder } from "./proposals";
import { findAnomalies } from "@/lib/anomalies";

// AIアシスタントが使う道具。どれも会社のデータを読むだけで、書き換えはしない。
// 結果はAIが読む JSON 文字列(金額は円の整数)。

const PERIOD = {
  type: "object",
  properties: {
    preset: { type: "string", enum: ["this-month", "last-month", "this-fy", "last-fy", "all", "custom"], description: "期間。今月・先月・今期・前期・すべて・指定(from/to)" },
    from: { type: "string", description: "custom のときの開始日 YYYY-MM-DD" },
    to: { type: "string", description: "custom のときの終了日 YYYY-MM-DD" },
  },
  required: ["preset"],
  additionalProperties: false,
} as const;

export const ASSISTANT_TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "get_business_summary",
    description: "指定した期間の売上(収益)・費用・利益と、いまの現預金の残高を返す。「今月の利益は?」「今期の売上は?」などに使う。",
    input_schema: { ...PERIOD },
  },
  {
    name: "list_receivables",
    description: "入金待ちの売上請求書(売掛金)を返す。取引先ごとの合計と、期日を過ぎたものが分かる。customer で取引先名の一部を指定して絞り込める。",
    input_schema: { type: "object", properties: { customer: { type: "string", description: "顧客名の一部(任意)" } }, additionalProperties: false },
  },
  {
    name: "list_payables",
    description: "支払待ちの受け取った請求書(買掛金)を返す。取引先ごとの合計と、期日を過ぎたものが分かる。vendor で取引先名の一部を指定して絞り込める。",
    input_schema: { type: "object", properties: { vendor: { type: "string", description: "取引先名の一部(任意)" } }, additionalProperties: false },
  },
  {
    name: "search_journal",
    description: "仕訳を検索する。摘要のキーワード、勘定科目の名前、金額の範囲、期間で探せる。新しい順に最大30件。",
    input_schema: {
      type: "object",
      properties: {
        keyword: { type: "string", description: "摘要・メモに含まれる言葉(任意)" },
        account: { type: "string", description: "勘定科目の名前かコード(例: 地代家賃, 5060)(任意)" },
        minAmount: { type: "integer", description: "金額の下限(任意)" },
        maxAmount: { type: "integer", description: "金額の上限(任意)" },
        from: { type: "string", description: "開始日 YYYY-MM-DD(任意)" },
        to: { type: "string", description: "終了日 YYYY-MM-DD(任意)" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_account_balance",
    description: "勘定科目の残高を返す(資産・負債は指定日時点の残高、収益・費用は今期の累計)。科目の名前の一部かコードで指定する。",
    input_schema: {
      type: "object",
      properties: { account: { type: "string", description: "勘定科目の名前の一部かコード" }, asOf: { type: "string", description: "基準日 YYYY-MM-DD(任意。省略すると今日)" } },
      required: ["account"],
      additionalProperties: false,
    },
  },
  {
    name: "get_expense_breakdown",
    description: "指定した期間の費用を勘定科目ごとに多い順で返す。「何にお金を使っている?」などに使う。",
    input_schema: { ...PERIOD },
  },
  {
    name: "get_sales_by_customer",
    description: "指定した期間の顧客別の売上(税抜)とABCランク、品目別の売上、前年同期との比較を返す。",
    input_schema: { ...PERIOD },
  },
  {
    name: "get_budget_progress",
    description: "今期の予算に対する実績と着地見込み、予算を超えそうな科目を返す。",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "propose_invoice",
    description:
      "売上の請求書の下書きを作る(まだ確定しない)。利用者が画面で内容を確かめて「実行する」を押したときだけ発行される。単価は税抜の円。請求日を省略すると今日、支払期限を省略すると翌月末。",
    input_schema: {
      type: "object",
      properties: {
        customerName: { type: "string", description: "請求先(顧客)の名前" },
        issueDate: { type: "string", description: "請求日 YYYY-MM-DD(任意)" },
        dueDate: { type: "string", description: "支払期限 YYYY-MM-DD(任意)" },
        lines: {
          type: "array",
          description: "明細",
          items: {
            type: "object",
            properties: {
              description: { type: "string", description: "品目" },
              quantity: { type: "number", description: "数量(省略すると1)" },
              unit: { type: "string", description: "単位(任意)" },
              unitPrice: { type: "integer", description: "単価(税抜・円)" },
              taxRate: { type: "integer", enum: [10, 8], description: "税率(省略すると10)" },
            },
            required: ["description", "unitPrice"],
          },
        },
        notes: { type: "string", description: "備考(任意)" },
      },
      required: ["customerName", "lines"],
    },
  },
  {
    name: "propose_journal",
    description:
      "仕訳の下書きを作る(まだ記帳しない)。利用者が画面で内容を確かめて「実行する」を押したときだけ記帳される。借方と貸方の合計は同じにすること。勘定科目は名前かコードで指定する。",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "日付 YYYY-MM-DD(任意。省略すると今日)" },
        description: { type: "string", description: "摘要" },
        lines: {
          type: "array",
          description: "仕訳の行。1行は借方か貸方のどちらか一方だけに金額を入れる",
          items: {
            type: "object",
            properties: { account: { type: "string", description: "勘定科目の名前かコード" }, debit: { type: "integer" }, credit: { type: "integer" } },
            required: ["account"],
          },
        },
      },
      required: ["description", "lines"],
    },
  },
  {
    name: "propose_reminder",
    description:
      "支払期限を過ぎた請求書の督促メールの下書きを作る(まだ送らない)。利用者が「実行する」を押したときだけ、いつもの督促の文面で顧客に送られる。請求書番号か顧客名で指定する。",
    input_schema: { type: "object", properties: { invoice: { type: "string", description: "請求書番号か顧客名" } }, required: ["invoice"] },
  },
  {
    name: "get_anomalies",
    description: "いつもと違うお金の動き(過去6か月と比べた費用の急増・売上の急減・いつもより大きい支払い・初めての取引先への大きな支払い)を返す。「何かおかしいところはある?」などに使う。",
    input_schema: { type: "object", properties: { month: { type: "string", description: "対象の月 YYYY-MM(任意。省略すると今月)" } }, additionalProperties: false },
  },
  {
    name: "get_todos",
    description: "いま会社でやるべきこと(レビュー待ち・承認待ち・期限切れの請求書・納付期限など)の一覧を返す。",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
];

type Input = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const DATE = /^\d{4}-\d{2}-\d{2}$/;

async function periodOf(companyId: string, input: Input) {
  const preset = str(input.preset) || "this-month";
  return resolvePeriod({ preset, from: str(input.from) || undefined, to: str(input.to) || undefined }, await getFiscalStartMonth(companyId));
}

async function findAccount(companyId: string, q: string) {
  const accounts = await prisma.account.findMany({ where: { companyId }, select: { id: true, code: true, name: true, category: true }, orderBy: { code: "asc" } });
  return accounts.find((a) => a.code === q) ?? accounts.find((a) => a.name === q) ?? accounts.find((a) => a.name.includes(q)) ?? null;
}

export async function runAssistantTool(ctx: { companyId: string; userId: string }, name: string, input: Input): Promise<unknown> {
  const { companyId } = ctx;
  switch (name) {
    case "propose_invoice":
      return proposeInvoice(ctx, input);
    case "propose_journal":
      return proposeJournal(ctx, input);
    case "propose_reminder":
      return proposeReminder(ctx, input);
    case "get_business_summary": {
      const period = await periodOf(companyId, input);
      const [is, cash] = await Promise.all([getIncomeStatement(companyId, toRange(period)), getCashBalance(companyId)]);
      return { period: period.label, revenue: is.totalRevenue, expense: is.totalExpense, profit: is.netIncome, cashBalanceNow: cash, link: "/income-statement" };
    }
    case "list_receivables":
    case "list_payables": {
      const issued = name === "list_receivables";
      const q = str(input[issued ? "customer" : "vendor"]);
      const aging = await getAging(companyId, issued ? "ISSUED" : "RECEIVED");
      const rows = aging.rows.filter((r) => !q || r.partyName.includes(q));
      return {
        today: aging.today,
        total: rows.reduce((s, r) => s + r.remaining, 0),
        overdueTotal: rows.filter((r) => r.overdueDays > 0).reduce((s, r) => s + r.remaining, 0),
        byParty: aging.parties.filter((p) => !q || p.name.includes(q)).slice(0, 20).map((p) => ({ name: p.name, remaining: p.total, invoices: p.count })),
        invoices: rows.slice(0, 30).map((r) => ({ number: r.invoiceNumber, party: r.partyName, dueDate: r.dueDate, remaining: r.remaining, overdueDays: r.overdueDays })),
        link: "/receivables",
      };
    }
    case "search_journal": {
      const account = str(input.account) ? await findAccount(companyId, str(input.account)) : null;
      const from = DATE.test(str(input.from)) ? str(input.from) : null;
      const to = DATE.test(str(input.to)) ? str(input.to) : null;
      const entries = await getJournalBook(companyId, {
        postedOnly: true,
        filter: {
          q: str(input.keyword) || undefined,
          accountId: account?.id,
          min: Number.isInteger(input.minAmount) ? (input.minAmount as number) : undefined,
          max: Number.isInteger(input.maxAmount) ? (input.maxAmount as number) : undefined,
        },
      });
      const inRange = entries.filter((e) => {
        const d = jstDateKey(e.date);
        return (!from || d >= from) && (!to || d <= to);
      });
      return {
        account: account ? `${account.code} ${account.name}` : null,
        count: inRange.length,
        entries: inRange.slice(0, 30).map((e) => ({
          date: jstDateKey(e.date),
          description: e.description,
          lines: e.lines.map((l) => ({ account: l.account.name, debit: l.debit, credit: l.credit })),
        })),
        link: "/journal",
      };
    }
    case "get_account_balance": {
      const account = await findAccount(companyId, str(input.account));
      if (!account) return { error: "その勘定科目が見つかりません" };
      const asOf = DATE.test(str(input.asOf)) ? str(input.asOf) : jstDateKey(new Date());
      const pl = account.category === "REVENUE" || account.category === "EXPENSE";
      const fy = pl ? resolvePeriod({ preset: "this-fy" }, await getFiscalStartMonth(companyId)) : null;
      const balances = await getAccountBalances(companyId, fy ? { ...toRange(fy), lt: nextDay(asOf) } : { lt: nextDay(asOf) });
      const b = balances.find((x) => x.account.id === account.id);
      return { account: `${account.code} ${account.name}`, basis: pl ? `今期(${fy!.from}〜${asOf})の累計` : `${asOf}時点の残高`, balance: b?.balance ?? 0, link: `/ledger?accountId=${account.id}` };
    }
    case "get_expense_breakdown": {
      const period = await periodOf(companyId, input);
      const is = await getIncomeStatement(companyId, toRange(period));
      return {
        period: period.label,
        total: is.totalExpense,
        accounts: [...is.expenseRows].sort((a, b) => b.balance - a.balance).slice(0, 15).map((r) => ({ account: r.account.name, amount: r.balance })),
        link: "/income-statement",
      };
    }
    case "get_sales_by_customer": {
      const period = await periodOf(companyId, input);
      const a = await getSalesAnalysis(companyId, period);
      return {
        period: period.label,
        total: a.total,
        priorYearSamePeriod: a.priorTotal,
        customers: a.customers.slice(0, 15).map((c) => ({ name: c.name, amount: c.amount, rank: c.rank, priorYear: c.prior })),
        lostCustomers: a.lost.slice(0, 10),
        items: a.items.slice(0, 10).map((i) => ({ name: i.name, amount: i.amount })),
        link: "/sales-analysis",
      };
    }
    case "get_budget_progress": {
      const p = await getBudgetProgress(companyId);
      const pick = (r: (typeof p.expense)[number]) => ({ account: r.name, budget: r.budget, actual: r.actual, forecast: r.forecast, status: r.status });
      return { year: p.year, elapsedMonths: p.elapsed, revenue: p.revenue.map(pick), expense: p.expense.map(pick), alerts: p.alerts, link: "/monthly/progress" };
    }
    case "get_anomalies": {
      const r = await findAnomalies(companyId, str(input.month) || null);
      return { month: r.month, anomalies: r.anomalies.map((a) => ({ title: a.title, detail: a.detail, amount: a.amount, link: a.href })), link: "/anomalies" };
    }
    case "get_todos": {
      const todos = await getTodos(companyId);
      return { todos: todos.map((t) => ({ label: t.label, count: t.count, detail: t.detail, link: t.href })) };
    }
    default:
      return { error: `不明な道具です: ${name}` };
  }
}

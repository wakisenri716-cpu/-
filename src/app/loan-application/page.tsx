"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { formatYen } from "@/lib/format";
import { PrintButton } from "@/components/PrintButton";

type Doc = {
  createdAt: string;
  createdBy: string;
  company: { name: string; address: string | null; representative: string | null; phone: string | null; email: string | null; registrationNumber: string | null; fiscalLabel: string };
  performance: { months: { month: string; revenue: number; expense: number; profit: number }[]; revenue: number; expense: number; profit: number; depreciation: number; bookedMonths: number; from: string; to: string };
  loan: { amount: number; months: number; grace: number; useKind: string; purpose: string; rateLabel: string; methodLabel: string; borrowMonth: string; firstPaymentMonth: string; lastMonth: string; monthlyPayment: number; interestTotal: number; schedule: { no: number; month: string; principal: number; interest: number; total: number; balance: number }[] };
  cashPlan: { months: { month: string; revenue: number; expense: number; loanIn: number; repayment: number; cash: number }[]; start: number; basis: string[]; existingRepayments: boolean };
  indicators: { capacity: number; firstYearRepayment: number; coverage: number | null; debtAfter: number; payback: number | null; lowestCash: number };
  existingLoans: { name: string; remaining: number; rate: string; monthly: number }[];
  narrative: { overview: string; purpose: string; repayment: string; risks: string };
  mode: "claude" | "template";
};

const ym = (m: string) => `${m.slice(0, 4)}年${Number(m.slice(5))}月`;
const input = "mt-0.5 block w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm";
const th = "border-b border-slate-300 px-2 py-1 text-left font-medium text-slate-600";
const td = "border-b border-slate-100 px-2 py-1 tabular-nums";

// 融資相談の資料(銀行・信用金庫・日本政策金融公庫に借入を相談するときの資料の下書き)
export default function LoanApplicationPage() {
  const [form, setForm] = useState({ amount: "", months: "60", annualRate: "1.5", graceMonths: "0", method: "EQUAL_PAYMENT", useKind: "WORKING", purpose: "" });
  const [doc, setDoc] = useState<Doc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/loan-application", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, amount: Number(form.amount.replaceAll(",", "")) * 10_000, months: Number(form.months), annualRate: Number(form.annualRate), graceMonths: Number(form.graceMonths) }) });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(body.error || "資料を作れませんでした");
    setDoc(body);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="print:hidden">
        <h1 className="text-2xl font-semibold">融資相談の資料</h1>
        <p className="mt-1 text-sm text-slate-600">
          銀行・信用金庫・日本政策金融公庫に借入を相談するときの資料の下書きを、帳簿の数字から作ります。業績・返済予定表・借りた場合の資金繰り・返済の余力を数字で並べ、説明の文はAIが書きます(印刷・PDF保存して持っていけます。何も保存しません)。いまの借入は
          <Link href="/loans" className="mx-1 text-indigo-700 hover:underline">借入金の管理</Link>
          の内容を使います。
        </p>
      </div>

      <form onSubmit={submit} className="grid gap-3 rounded-xl border border-indigo-200 bg-indigo-50/50 p-4 text-sm sm:grid-cols-3 print:hidden">
        <label className="text-xs text-slate-600">
          借りたい額(万円)
          <input required inputMode="numeric" value={form.amount} onChange={set("amount")} placeholder="例: 500" className={input} />
        </label>
        <label className="text-xs text-slate-600">
          返済期間(か月)
          <input type="number" min={6} max={360} value={form.months} onChange={set("months")} className={input} />
        </label>
        <label className="text-xs text-slate-600">
          年利(%・目安)
          <input type="number" step="0.01" min={0} max={15} value={form.annualRate} onChange={set("annualRate")} className={input} />
        </label>
        <label className="text-xs text-slate-600">
          据置期間(か月)
          <input type="number" min={0} max={36} value={form.graceMonths} onChange={set("graceMonths")} className={input} />
        </label>
        <label className="text-xs text-slate-600">
          返済の方法
          <select value={form.method} onChange={set("method")} className={input}>
            <option value="EQUAL_PAYMENT">元利均等(毎月同じ額)</option>
            <option value="EQUAL_PRINCIPAL">元金均等(元金が同じ)</option>
          </select>
        </label>
        <label className="text-xs text-slate-600">
          資金の種類
          <select value={form.useKind} onChange={set("useKind")} className={input}>
            <option value="WORKING">運転資金(仕入・人件費など)</option>
            <option value="EQUIPMENT">設備資金(機械・内装・車など)</option>
          </select>
        </label>
        <label className="text-xs text-slate-600 sm:col-span-3">
          使いみち・借りたい理由
          <textarea required value={form.purpose} onChange={set("purpose")} rows={3} maxLength={1000} placeholder="例: 新しい店舗の内装と厨房機器(見積 420万円)と、開店までの3か月分の人件費。" className={input} />
        </label>
        <div className="sm:col-span-3">
          <button disabled={busy} className="rounded-md bg-vermilion-600 px-5 py-2 text-sm font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
            {busy ? "資料を作っています..." : "資料を作る"}
          </button>
        </div>
      </form>

      {error && <p className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-700 print:hidden">{error}</p>}

      {doc && (
        <article className="space-y-6 rounded-xl border border-slate-200 bg-white p-6 text-sm shadow-sm print:border-0 print:p-0 print:shadow-none">
          <header className="flex flex-wrap items-start justify-between gap-3 border-b-2 border-slate-800 pb-3">
            <div>
              <h2 className="text-xl font-bold">借入のご相談資料</h2>
              <p className="text-slate-600">{doc.company.name}</p>
            </div>
            <div className="text-right text-xs text-slate-500">
              <p>作成日 {doc.createdAt.replaceAll("-", "/")}</p>
              <PrintButton />
            </div>
          </header>

          <section>
            <h3 className="mb-2 font-semibold">1. 会社の概要</h3>
            <table className="w-full text-sm">
              <tbody>
                {[
                  ["会社名", doc.company.name],
                  ["代表者", doc.company.representative],
                  ["所在地", doc.company.address],
                  ["電話・メール", [doc.company.phone, doc.company.email].filter(Boolean).join(" / ")],
                  ["登録番号(インボイス)", doc.company.registrationNumber],
                  ["決算期", doc.company.fiscalLabel],
                ].map(([k, v]) => (
                  <tr key={k}>
                    <th className="w-40 border-b border-slate-100 px-2 py-1 text-left font-medium text-slate-600">{k}</th>
                    <td className="border-b border-slate-100 px-2 py-1">{v || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 leading-relaxed text-slate-800">{doc.narrative.overview}</p>
          </section>

          <section>
            <h3 className="mb-2 font-semibold">
              2. 直近の業績({doc.performance.from}〜{doc.performance.to}・{doc.performance.months.length}か月)
            </h3>
            <div className="grid gap-2 sm:grid-cols-4">
              {[
                ["売上", doc.performance.revenue],
                ["費用", doc.performance.expense],
                ["利益", doc.performance.profit],
                ["減価償却費", doc.performance.depreciation],
              ].map(([k, v]) => (
                <div key={k as string} className="rounded-lg bg-slate-50 px-3 py-2">
                  <p className="text-xs text-slate-500">{k}</p>
                  <p className="font-semibold tabular-nums">{formatYen(v as number)}</p>
                </div>
              ))}
            </div>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr>
                    <th className={th}>月</th>
                    <th className={`${th} text-right`}>売上</th>
                    <th className={`${th} text-right`}>費用</th>
                    <th className={`${th} text-right`}>利益</th>
                  </tr>
                </thead>
                <tbody>
                  {doc.performance.months.map((m) => (
                    <tr key={m.month}>
                      <td className={td}>{ym(m.month)}</td>
                      <td className={`${td} text-right`}>{formatYen(m.revenue)}</td>
                      <td className={`${td} text-right`}>{formatYen(m.expense)}</td>
                      <td className={`${td} text-right`}>{formatYen(m.profit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h3 className="mb-2 font-semibold">3. ご相談の内容</h3>
            <table className="w-full text-sm">
              <tbody>
                {[
                  ["借入額", formatYen(doc.loan.amount)],
                  ["資金の種類", doc.loan.useKind === "EQUIPMENT" ? "設備資金" : "運転資金"],
                  ["返済期間", `${doc.loan.months}か月(据置${doc.loan.grace}か月)・${ym(doc.loan.firstPaymentMonth)}〜${ym(doc.loan.lastMonth)}`],
                  ["年利(目安)・返済方法", `${doc.loan.rateLabel}・${doc.loan.methodLabel}`],
                  ["毎月の返済額(初回)", formatYen(doc.loan.monthlyPayment)],
                  ["利息の合計(目安)", formatYen(doc.loan.interestTotal)],
                  ["使いみち", doc.loan.purpose],
                ].map(([k, v]) => (
                  <tr key={k}>
                    <th className="w-44 border-b border-slate-100 px-2 py-1 text-left align-top font-medium text-slate-600">{k}</th>
                    <td className="border-b border-slate-100 px-2 py-1 whitespace-pre-wrap">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 leading-relaxed text-slate-800">{doc.narrative.purpose}</p>
          </section>

          <section>
            <h3 className="mb-2 font-semibold">4. 借りた場合の資金繰りの見込み(12か月)</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr>
                    <th className={th}>月</th>
                    <th className={`${th} text-right`}>売上</th>
                    <th className={`${th} text-right`}>費用</th>
                    <th className={`${th} text-right`}>借入</th>
                    <th className={`${th} text-right`}>返済</th>
                    <th className={`${th} text-right`}>月末の現預金</th>
                  </tr>
                </thead>
                <tbody>
                  {doc.cashPlan.months.map((m) => (
                    <tr key={m.month}>
                      <td className={td}>{ym(m.month)}</td>
                      <td className={`${td} text-right`}>{formatYen(m.revenue)}</td>
                      <td className={`${td} text-right`}>{formatYen(m.expense)}</td>
                      <td className={`${td} text-right`}>{m.loanIn ? formatYen(m.loanIn) : ""}</td>
                      <td className={`${td} text-right`}>{m.repayment ? formatYen(m.repayment) : ""}</td>
                      <td className={`${td} text-right font-medium ${m.cash < 0 ? "text-rose-700" : ""}`}>{formatYen(m.cash)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              売上・費用は直近3か月({doc.cashPlan.basis.join("・")})の平均。いまの現預金 {formatYen(doc.cashPlan.start)} から計算した目安です{doc.cashPlan.existingRepayments ? "(いまの借入の返済も入っています)" : ""}。
            </p>
          </section>

          <section>
            <h3 className="mb-2 font-semibold">5. 返済の見通し</h3>
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded-lg bg-slate-50 px-3 py-2">
                <p className="text-xs text-slate-500">返済の原資(年・利益+減価償却費)</p>
                <p className="font-semibold tabular-nums">{formatYen(doc.indicators.capacity)}</p>
              </div>
              <div className="rounded-lg bg-slate-50 px-3 py-2">
                <p className="text-xs text-slate-500">1年目の元金返済(いまの借入も含む)</p>
                <p className="font-semibold tabular-nums">
                  {formatYen(doc.indicators.firstYearRepayment)}
                  {doc.indicators.coverage !== null && <span className="ml-1 text-xs font-normal text-slate-500">(原資の{(1 / doc.indicators.coverage * 100).toFixed(0)}%)</span>}
                </p>
              </div>
              <div className="rounded-lg bg-slate-50 px-3 py-2">
                <p className="text-xs text-slate-500">債務償還年数の目安</p>
                <p className="font-semibold tabular-nums">{doc.indicators.payback === null ? "—(利益が出ていません)" : `${doc.indicators.payback.toFixed(1)}年`}</p>
              </div>
            </div>
            {doc.existingLoans.length > 0 && (
              <p className="mt-2 text-xs text-slate-600">
                いまの借入: {doc.existingLoans.map((l) => `${l.name} 残高${formatYen(l.remaining)}(年${l.rate}・月${formatYen(l.monthly)})`).join(" / ")}
              </p>
            )}
            <p className="mt-2 leading-relaxed text-slate-800">{doc.narrative.repayment}</p>
            {doc.narrative.risks && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 leading-relaxed text-amber-900">{doc.narrative.risks}</p>}
          </section>

          <section>
            <h3 className="mb-2 font-semibold">6. 返済予定表(新しい借入・目安)</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr>
                    <th className={th}>回</th>
                    <th className={th}>月</th>
                    <th className={`${th} text-right`}>元金</th>
                    <th className={`${th} text-right`}>利息</th>
                    <th className={`${th} text-right`}>返済額</th>
                    <th className={`${th} text-right`}>残高</th>
                  </tr>
                </thead>
                <tbody>
                  {doc.loan.schedule.slice(0, 24).map((r) => (
                    <tr key={r.no}>
                      <td className={td}>{r.no}</td>
                      <td className={td}>{ym(r.month)}</td>
                      <td className={`${td} text-right`}>{formatYen(r.principal)}</td>
                      <td className={`${td} text-right`}>{formatYen(r.interest)}</td>
                      <td className={`${td} text-right`}>{formatYen(r.total)}</td>
                      <td className={`${td} text-right`}>{formatYen(r.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {doc.loan.schedule.length > 24 && <p className="mt-1 text-xs text-slate-500">25回目以降は省略しています(全{doc.loan.schedule.length}回)。利息は残高×年利÷12の目安で、金融機関の予定表とは少し違うことがあります。</p>}
          </section>

          <footer className="border-t pt-2 text-xs text-slate-500">
            数字は会計帳簿({doc.performance.bookedMonths}か月分の記帳)から計算した目安です。{doc.mode === "claude" ? "説明の文はAIが下書きしました。" : ""}作成: {doc.createdBy}
          </footer>
        </article>
      )}
    </div>
  );
}

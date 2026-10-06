"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { formatYen } from "@/lib/format";
import { buildSchedule, formatRate, METHOD_LABEL, type LoanMethod, type ScheduleRow } from "@/lib/accounting/loanSchedule";

type Loan = {
  id: string;
  name: string;
  principal: number;
  annualRate: number;
  months: number;
  method: LoanMethod;
  borrowedAt: string;
  firstPaymentMonth: string;
  paymentDay: number;
  bankCode: string;
  notes: string | null;
  active: boolean;
  opening: boolean;
  schedule: ScheduleRow[];
  paidCount: number;
  paidPrincipal: number;
  paidInterest: number;
  remaining: number;
  futureInterest: number;
  next: ScheduleRow | null;
  due: string[];
  lastPaid: string | null;
  done: boolean;
};
type Data = {
  today: string;
  rows: Loan[];
  banks: { code: string; name: string }[];
  summary: { remaining: number; bookBalance: number; thisMonth: number; next12: number; next12Interest: number; due: number };
};

const inputClass = "mt-1 w-full rounded-md border px-3 py-2 text-sm disabled:bg-slate-50";
const ym = (m: string) => `${m.slice(0, 4)}/${Number(m.slice(5))}`;
const ymd = (d: string) => d.replaceAll("-", "/");
const num = (v: string) => Number(v.replaceAll(",", "").trim());

function LoanForm({ data, loan, busy, onSubmit, onCancel }: { data: Data; loan: Loan | null; busy: boolean; onSubmit: (body: object) => void; onCancel: () => void }) {
  const locked = !!loan && loan.paidCount > 0;
  const [principal, setPrincipal] = useState(loan ? String(loan.principal) : "");
  const [rate, setRate] = useState(loan ? String(loan.annualRate / 1000) : "1.5");
  const [months, setMonths] = useState(loan ? String(loan.months) : "60");
  const [method, setMethod] = useState<LoanMethod>(loan?.method ?? "EQUAL_PAYMENT");
  const [borrowedAt, setBorrowedAt] = useState(loan?.borrowedAt ?? data.today);
  const [first, setFirst] = useState(loan?.firstPaymentMonth ?? nextMonth(data.today.slice(0, 7)));
  const [day, setDay] = useState(loan ? String(loan.paymentDay) : "25");
  const [opening, setOpening] = useState(false);

  const preview = useMemo(() => {
    const p = num(principal);
    const n = num(months);
    const r = Math.round(Number(rate) * 1000);
    if (!Number.isInteger(p) || p <= 0 || !Number.isInteger(n) || n < 1 || n > 600 || !Number.isFinite(r) || r < 0 || !/^\d{4}-\d{2}$/.test(first)) return null;
    const rows = buildSchedule({ principal: p, annualRate: r, months: n, method, firstPaymentMonth: first, paymentDay: Number(day) || 31 });
    return { rows, interest: rows.reduce((s, x) => s + x.interest, 0) };
  }, [principal, rate, months, method, first, day]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    onSubmit({ name: f.name, principal, annualRate: rate, months, method, borrowedAt, firstPaymentMonth: first, paymentDay: day, bankCode: f.bankCode, notes: f.notes, ...(loan ? {} : { opening }) });
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {locked && <p className="text-xs text-slate-500">返済を記帳し始めた借入は、借入額・年利・回数・返済方法・借りた日・最初の返済月を変えられません。</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm sm:col-span-2">
          <span className="text-slate-600">名前</span>
          <input name="name" required maxLength={60} defaultValue={loan?.name} placeholder="例: みどり銀行 運転資金" className={inputClass} />
        </label>
        <label className="block text-sm">
          <span className="text-slate-600">借入額(円)</span>
          <input value={principal} onChange={(e) => setPrincipal(e.target.value)} disabled={locked} required inputMode="numeric" placeholder="5,000,000" className={inputClass} />
        </label>
        <label className="block text-sm">
          <span className="text-slate-600">年利(%)</span>
          <input value={rate} onChange={(e) => setRate(e.target.value)} disabled={locked} required inputMode="decimal" placeholder="1.5" className={inputClass} />
        </label>
        <label className="block text-sm">
          <span className="text-slate-600">返済回数(月)</span>
          <div className="mt-1 flex gap-1">
            <input value={months} onChange={(e) => setMonths(e.target.value)} disabled={locked} required inputMode="numeric" className="w-20 rounded-md border px-3 py-2 text-sm disabled:bg-slate-50" />
            {!locked &&
              [36, 60, 84, 120].map((m) => (
                <button key={m} type="button" onClick={() => setMonths(String(m))} className="rounded-md border px-2 text-xs hover:bg-slate-50">
                  {m / 12}年
                </button>
              ))}
          </div>
        </label>
        <label className="block text-sm">
          <span className="text-slate-600">返済方法</span>
          <select value={method} onChange={(e) => setMethod(e.target.value as LoanMethod)} disabled={locked} className={inputClass}>
            {(Object.keys(METHOD_LABEL) as LoanMethod[]).map((k) => (
              <option key={k} value={k}>
                {METHOD_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-slate-600">借りた日</span>
          <input type="date" value={borrowedAt} onChange={(e) => setBorrowedAt(e.target.value)} disabled={locked} required className={inputClass} />
        </label>
        <label className="block text-sm">
          <span className="text-slate-600">最初の返済月</span>
          <input type="month" value={first} onChange={(e) => setFirst(e.target.value)} disabled={locked} required className={inputClass} />
        </label>
        <label className="block text-sm">
          <span className="text-slate-600">返済日(毎月)</span>
          <select value={day} onChange={(e) => setDay(e.target.value)} className={inputClass}>
            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                {d === 31 ? "月末" : `${d}日`}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-slate-600">返済する口座</span>
          <select name="bankCode" defaultValue={loan?.bankCode ?? "1020"} className={inputClass}>
            {data.banks.map((b) => (
              <option key={b.code} value={b.code}>
                {b.code} {b.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm sm:col-span-2">
          <span className="text-slate-600">メモ(任意)</span>
          <input name="notes" maxLength={300} defaultValue={loan?.notes ?? ""} placeholder="例: 信用保証協会付き・据置なし" className={inputClass} />
        </label>
      </div>
      {preview && !locked && (
        <div className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">
          <p>
            1回目({ymd(preview.rows[0].date)}): 元金 {formatYen(preview.rows[0].principal)} + 利息 {formatYen(preview.rows[0].interest)} = <strong>{formatYen(preview.rows[0].total)}</strong>
          </p>
          <p>
            最終回 {ymd(preview.rows.at(-1)!.date)}・利息の合計(目安) <strong>{formatYen(preview.interest)}</strong>
          </p>
          <p className="mt-1 text-xs text-slate-500">利息は「残高 × 年利 ÷ 12」の目安です。銀行の返済予定表と違うときは、記帳するときに実際の額を入れられます。</p>
        </div>
      )}
      {!loan && (
        <label className="flex items-start gap-2 rounded-lg border border-slate-200 p-3 text-sm">
          <input type="checkbox" checked={opening} onChange={(e) => setOpening(e.target.checked)} className="mt-1" />
          <span>
            借入の仕訳も作る
            <span className="block text-xs text-slate-500">まだ記帳していないときに。借りた日付で「普通預金など / 借入金」の仕訳を作ります。銀行明細などで記帳済みなら、チェックしないでください。</span>
          </span>
        </label>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-md border px-4 py-2 text-sm">
          やめる
        </button>
        <button type="submit" disabled={busy} className="rounded-md bg-vermilion-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-vermilion-700 disabled:opacity-50">
          {busy ? "保存中..." : loan ? "保存" : "登録"}
        </button>
      </div>
    </form>
  );
}

function nextMonth(month: string) {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

function PayForm({ loan, row, busy, onSubmit, onCancel }: { loan: Loan; row: ScheduleRow; busy: boolean; onSubmit: (body: object) => void; onCancel: () => void }) {
  const last = row.no === loan.months;
  const [principal, setPrincipal] = useState(String(row.principal));
  const [interest, setInterest] = useState(String(row.interest));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ action: "pay", month: row.month, principal, interest });
      }}
      className="space-y-3"
    >
      <p className="text-sm text-slate-600">
        {ymd(row.date)} の返済({row.no}/{loan.months}回目)を記帳します。銀行の返済予定表・通帳と額が違うときは、実際の額に直してください。
      </p>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm">
          <span className="text-slate-600">元金</span>
          <input value={principal} onChange={(e) => setPrincipal(e.target.value)} disabled={last} inputMode="numeric" className={`${inputClass} text-right tabular-nums`} />
        </label>
        <label className="block text-sm">
          <span className="text-slate-600">利息</span>
          <input value={interest} onChange={(e) => setInterest(e.target.value)} inputMode="numeric" className={`${inputClass} text-right tabular-nums`} />
        </label>
      </div>
      <p className="rounded-md bg-slate-50 px-3 py-2 text-sm">
        借入金 {formatYen(num(principal) || 0)}・支払利息 {formatYen(num(interest) || 0)} / 預金 <strong>{formatYen((num(principal) || 0) + (num(interest) || 0))}</strong>
        {last && <span className="block text-xs text-slate-500">最後の回は、残りの元金をすべて返済します。</span>}
      </p>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-md border px-4 py-2 text-sm">
          やめる
        </button>
        <button type="submit" disabled={busy} className="rounded-md bg-vermilion-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-vermilion-700 disabled:opacity-50">
          記帳する
        </button>
      </div>
    </form>
  );
}

export default function LoansPage() {
  const [data, setData] = useState<Data | null>(null);
  const [modal, setModal] = useState<{ kind: "edit"; loan: Loan | null } | { kind: "pay"; loan: Loan; row: ScheduleRow } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/loans");
    if (res.ok) setData(await res.json());
  }, []);

  useEffect(() => {
    // Fetch-on-mount: setState always lands after the fetch's await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function call(url: string, method: string, body: object | undefined, done: (json: Record<string, unknown>) => string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(json.error || "処理できませんでした");
      return false;
    }
    setMessage(done(json));
    setModal(null);
    await load();
    return true;
  }

  const s = data?.summary;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">借入金</h1>
          <p className="mt-1 text-sm text-slate-600">
            銀行などからの借入を登録すると、返済予定表(元利均等・元金均等)を作ります。毎月の返済を「借入金・支払利息 / 預金」で記帳し、残高と今後の返済額を確かめられます。返済の予定は資金繰り予測にも入ります。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {s && s.due > 0 && (
            <button
              onClick={() => call("/api/loans", "POST", { action: "postDue" }, (j) => `${j.posted}回分の返済を記帳しました${(j.errors as string[]).length ? `(記帳できなかったもの: ${(j.errors as string[]).join("、")})` : ""}`)}
              disabled={busy}
              className="rounded-md border border-indigo-600 bg-white px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-50"
            >
              返済日が来た分を予定どおり記帳({s.due})
            </button>
          )}
          <button onClick={() => setModal({ kind: "edit", loan: null })} className="rounded-md bg-vermilion-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-vermilion-700">
            + 借入を登録
          </button>
        </div>
      </div>

      {error && <div className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</div>}
      {message && <div className="rounded-md bg-emerald-50 px-4 py-2 text-sm text-emerald-800">{message}</div>}

      {s && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { label: "借入の残高", value: formatYen(s.remaining) },
              { label: "今月の返済額", value: formatYen(s.thisMonth) },
              { label: "これから12か月の返済額", value: formatYen(s.next12) },
              { label: "これから12か月の利息(目安)", value: formatYen(s.next12Interest) },
            ].map((t) => (
              <div key={t.label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-xs text-slate-500">{t.label}</p>
                <p className="mt-1 text-xl font-semibold tabular-nums">{t.value}</p>
              </div>
            ))}
          </div>
          {data.rows.length > 0 && s.bookBalance !== s.remaining && (
            <div className="rounded-md bg-amber-50 px-4 py-2 text-sm text-amber-900">
              帳簿の「借入金」の残高は {formatYen(s.bookBalance)} で、ここに登録した借入の残高 {formatYen(s.remaining)} と {formatYen(Math.abs(s.bookBalance - s.remaining))} 違います。借入の仕訳を記帳していないか、登録していない借入がないか確かめてください。
            </div>
          )}
        </>
      )}

      {data && (
        <div className="space-y-3">
          {data.rows.map((l) => (
            <article key={l.id} className={`space-y-3 rounded-xl border bg-white p-4 shadow-sm ${l.due.length ? "border-amber-300" : "border-slate-200"} ${!l.active || l.done ? "opacity-75" : ""}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium">
                    {l.name}
                    {!l.active && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-normal text-slate-600">止めています</span>}
                    {l.done && <span className="ml-2 rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-normal text-emerald-800">完済</span>}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {[
                      `${formatYen(l.principal)}・年利 ${formatRate(l.annualRate)}・${l.months}回`,
                      METHOD_LABEL[l.method].split("(")[0],
                      `${ymd(l.borrowedAt)} 借入${l.opening ? "(仕訳あり)" : ""}`,
                      `毎月${l.paymentDay === 31 ? "末日" : `${l.paymentDay}日`}返済`,
                      l.notes,
                    ]
                      .filter(Boolean)
                      .join(" / ")}
                  </p>
                </div>
                <div className="sm:text-right">
                  <p className="text-xs text-slate-500">残高</p>
                  <p className="text-lg font-semibold tabular-nums">{formatYen(l.remaining)}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 text-xs text-slate-600">
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`${l.months}回中${l.paidCount}回を返済`}>
                  <div className="h-full rounded-full bg-indigo-500" style={{ width: `${(l.paidCount / l.months) * 100}%` }} />
                </div>
                <span className="whitespace-nowrap tabular-nums">
                  {l.paidCount}/{l.months}回・払った利息 {formatYen(l.paidInterest)}
                </span>
              </div>
              {l.next && (
                <div className={`flex flex-wrap items-center justify-between gap-2 rounded-md px-3 py-2 text-sm ${l.due.length ? "bg-amber-50 text-amber-900" : "bg-slate-50 text-slate-700"}`}>
                  <span>
                    {l.due.length ? `返済日が来ています(${l.due.length}回分)・` : "次の返済: "}
                    {ymd(l.next.date)} 元金 {formatYen(l.next.principal)} + 利息 {formatYen(l.next.interest)} = <strong>{formatYen(l.next.total)}</strong>
                  </span>
                  {l.due.length > 0 && l.active && (
                    <button onClick={() => setModal({ kind: "pay", loan: l, row: l.next! })} disabled={busy} className="rounded-md bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700">
                      {ym(l.next.month)}分を記帳
                    </button>
                  )}
                </div>
              )}
              <div className="flex flex-wrap gap-x-3 gap-y-1 border-t pt-2 text-sm">
                <details className="w-full">
                  <summary className="cursor-pointer text-slate-600 hover:underline">返済予定表</summary>
                  <div className="mt-2 max-h-80 overflow-auto">
                    <table className="w-full text-xs tabular-nums">
                      <thead className="sticky top-0 bg-white text-slate-500">
                        <tr>
                          <th className="px-2 py-1 text-left font-medium">回</th>
                          <th className="px-2 py-1 text-left font-medium">返済日</th>
                          <th className="px-2 py-1 text-right font-medium">元金</th>
                          <th className="px-2 py-1 text-right font-medium">利息</th>
                          <th className="px-2 py-1 text-right font-medium">返済額</th>
                          <th className="px-2 py-1 text-right font-medium">残高</th>
                          <th className="px-2 py-1" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {l.schedule.map((r) => (
                          <tr key={r.month} className={r.posted ? "text-slate-500" : r.date <= data.today ? "text-amber-800" : ""}>
                            <td className="px-2 py-1">{r.no}</td>
                            <td className="px-2 py-1 whitespace-nowrap">{ymd(r.date)}</td>
                            <td className="px-2 py-1 text-right">{formatYen(r.principal)}</td>
                            <td className="px-2 py-1 text-right">{formatYen(r.interest)}</td>
                            <td className="px-2 py-1 text-right">{formatYen(r.total)}</td>
                            <td className="px-2 py-1 text-right">{formatYen(r.balance)}</td>
                            <td className="px-2 py-1 text-right whitespace-nowrap">{r.posted ? "記帳済み" : ""}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
                <button onClick={() => setModal({ kind: "edit", loan: l })} className="text-slate-600 hover:underline">
                  編集
                </button>
                {l.lastPaid && (
                  <button
                    onClick={() => confirm(`${ym(l.lastPaid!)}分の返済の記帳を取り消しますか?(仕訳は取消になります)`) && call(`/api/loans/${l.id}`, "POST", { action: "undo" }, (j) => `${ym(String(j.month))}分の記帳を取り消しました`)}
                    disabled={busy}
                    className="text-slate-600 hover:underline"
                  >
                    {ym(l.lastPaid)}分の記帳を取り消す
                  </button>
                )}
                {!l.done && (
                  <button onClick={() => call(`/api/loans/${l.id}`, "PATCH", { active: !l.active }, () => (l.active ? "記帳を止めました(繰上返済・借換えのときなど)" : "再開しました"))} disabled={busy} className="text-slate-600 hover:underline">
                    {l.active ? "止める" : "再開する"}
                  </button>
                )}
                {l.paidCount === 0 && (
                  <button
                    onClick={() => confirm(`「${l.name}」を削除しますか?${l.opening ? "借入の仕訳も取消になります" : ""}`) && call(`/api/loans/${l.id}`, "DELETE", undefined, () => "削除しました")}
                    disabled={busy}
                    className="text-slate-500 hover:text-rose-700 hover:underline"
                  >
                    削除
                  </button>
                )}
              </div>
            </article>
          ))}
          {data.rows.length === 0 && (
            <p className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">まだ借入がありません。「+ 借入を登録」から、銀行などからの借入を登録してください。</p>
          )}
        </div>
      )}

      {modal && data && (
        <div className="fixed inset-0 z-20 flex items-end justify-center bg-slate-900/30 p-4 sm:items-center" onClick={() => setModal(null)}>
          <div onClick={(e) => e.stopPropagation()} className="max-h-[90vh] w-full max-w-2xl space-y-3 overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
            {modal.kind === "edit" ? (
              <>
                <h2 className="font-semibold">{modal.loan ? "借入を編集" : "借入を登録"}</h2>
                <LoanForm
                  data={data}
                  loan={modal.loan}
                  busy={busy}
                  onSubmit={(body) => (modal.loan ? call(`/api/loans/${modal.loan.id}`, "PATCH", body, () => "保存しました") : call("/api/loans", "POST", body, () => "借入を登録しました"))}
                  onCancel={() => setModal(null)}
                />
              </>
            ) : (
              <>
                <h2 className="font-semibold">「{modal.loan.name}」の返済を記帳</h2>
                <PayForm
                  loan={modal.loan}
                  row={modal.row}
                  busy={busy}
                  onSubmit={(body) => call(`/api/loans/${modal.loan.id}`, "POST", body, (j) => `${ym(String(j.month))}分の返済を記帳しました`)}
                  onCancel={() => setModal(null)}
                />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { formatYen } from "@/lib/format";

type Fee = {
  id: string;
  invoiceNumber: string | null;
  vendorId: string | null;
  vendorName: string;
  issueDate: string | null;
  total: number;
  remaining: number;
  suggestedBase: number;
  suggestedAmount: number;
  withholdings: { id: string; amount: number; base: number | null; category: string | null; date: string }[];
};
type Statements = {
  year: number;
  fees: { vendorId: string; name: string; address: string | null; categories: string[]; base: number; tax: number; count: number; mustSubmit: boolean }[];
  salaries: { name: string; gross: number; incomeTax: number }[];
  summary: {
    salary: { people: number; amount: number; tax: number };
    fee: { people: number; amount: number; tax: number; submitPeople: number; submitAmount: number; submitTax: number };
  };
};
type Item = { kind: "INCOME_TAX" | "RESIDENT_TAX"; key: string; label: string; detail: string; amount: number; deadline: string; paidAt: string | null; overdue: boolean };
type Remittances = { year: number; settings: { withholdingSpecial: boolean; residentTaxSpecial: boolean; salaryPaidNextMonth: boolean }; items: Item[] };
type Data = { fees: Fee[]; statements: Statements; remittances: Remittances };

const CATEGORIES = [
  ["DESIGN", "原稿料・デザイン料など"],
  ["LECTURE", "講演料・出演料など"],
  ["PROFESSIONAL", "税理士・弁護士・社労士などの報酬"],
  ["OTHER", "その他の報酬"],
] as const;
const CATEGORY_LABEL = Object.fromEntries(CATEGORIES);
const slash = (k: string) => k.replaceAll("-", "/");
const withholdingOf = (base: number) => (base <= 0 ? 0 : base <= 1_000_000 ? Math.floor((base * 1021) / 10000) : Math.floor(102_100 + ((base - 1_000_000) * 2042) / 10000));

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function WithholdingPage() {
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [tab, setTab] = useState<"remit" | "fees" | "statements">("remit");
  const [data, setData] = useState<Data | null>(null);
  const [forms, setForms] = useState<Record<string, { category: string; base: string; amount: string; date: string }>>({});
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/withholding?year=${year}`);
    const body = await res.json();
    if (res.ok) setData(body);
    else setError(body.error);
  }, [year]);

  useEffect(() => {
    // Fetch-on-mount/year change: setState always lands after the fetch's await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function post(body: Record<string, unknown>, done: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    const res = await fetch("/api/withholding", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(json.error || "保存できませんでした");
      return false;
    }
    setMessage(done);
    await load();
    return true;
  }

  const formOf = (f: Fee) => forms[f.id] ?? { category: "DESIGN", base: String(f.suggestedBase), amount: String(f.suggestedAmount), date: today() };
  const setForm = (f: Fee, patch: Partial<{ category: string; base: string; amount: string; date: string }>) =>
    setForms((prev) => {
      const cur = prev[f.id] ?? formOf(f);
      const next = { ...cur, ...patch };
      if (patch.base !== undefined) next.amount = String(withholdingOf(Number(patch.base) || 0));
      return { ...prev, [f.id]: next };
    });

  const r = data?.remittances;
  const unpaid = r?.items.filter((i) => !i.paidAt) ?? [];
  const s = data?.statements;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">源泉徴収・納付</h1>
          <p className="mt-1 text-sm text-slate-600">
            給料と報酬から預かった源泉所得税・住民税の納付額と期限、個人への報酬の源泉徴収、年末の支払調書・法定調書合計表の集計をまとめて管理します。
          </p>
        </div>
        <label className="text-sm">
          <span className="sr-only">年</span>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="rounded-md border px-3 py-2">
            {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() + 1 - i).map((y) => (
              <option key={y} value={y}>
                {y}年
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <div className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</div>}
      {message && <div className="rounded-md bg-emerald-50 px-4 py-2 text-sm text-emerald-800">{message}</div>}

      <div className="flex gap-2 overflow-x-auto border-b">
        {(
          [
            ["remit", `納付${unpaid.length ? ` (未納 ${unpaid.length})` : ""}`],
            ["fees", "報酬の源泉徴収"],
            ["statements", "支払調書・法定調書"],
          ] as const
        ).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} className={`px-3 py-2 text-sm font-medium whitespace-nowrap ${tab === key ? "border-b-2 border-indigo-600 text-indigo-700" : "text-slate-500"}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === "remit" && r && (
        <div className="space-y-4">
          <section className="flex flex-wrap gap-x-6 gap-y-2 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
            {(
              [
                ["salaryPaidNextMonth", "給料は働いた月の翌月に払う"],
                ["withholdingSpecial", "源泉所得税の納期の特例(年2回)"],
                ["residentTaxSpecial", "住民税の納期の特例(年2回)"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2">
                <input type="checkbox" checked={r.settings[key]} disabled={busy} onChange={(e) => post({ action: "settings", [key]: e.target.checked }, "設定を保存しました")} />
                {label}
              </label>
            ))}
          </section>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <ul className="divide-y">
              {r.items.map((i) => (
                <li key={`${i.kind}-${i.key}`} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${i.kind === "INCOME_TAX" ? "bg-indigo-100 text-indigo-800" : "bg-teal-100 text-teal-800"}`}>
                        {i.kind === "INCOME_TAX" ? "源泉所得税" : "住民税"}
                      </span>
                      <span className="font-medium">{i.label}</span>
                    </div>
                    <div className="text-xs text-slate-500">{i.detail}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="text-right">
                      <div className="font-semibold tabular-nums">{formatYen(i.amount)}</div>
                      <div className={`text-xs ${i.paidAt ? "text-emerald-700" : i.overdue ? "font-semibold text-rose-700" : "text-slate-500"}`}>
                        {i.paidAt ? `${slash(i.paidAt)} 納付済み` : `期限 ${slash(i.deadline)}${i.overdue ? "(過ぎています)" : ""}`}
                      </div>
                    </div>
                    {i.paidAt ? (
                      <button onClick={() => post({ action: "remit", kind: i.kind, period: i.key, undo: true }, "納付済みを取り消しました")} disabled={busy} className="text-xs text-slate-500 hover:underline">
                        取消
                      </button>
                    ) : (
                      <button
                        onClick={() => post({ action: "remit", kind: i.kind, period: i.key, amount: i.amount, paidAt: today() }, `${i.label}を納付済みにしました`)}
                        disabled={busy}
                        className="rounded-md border border-slate-300 px-3 py-1.5 text-xs hover:bg-slate-50"
                      >
                        納付済みにする
                      </button>
                    )}
                  </div>
                </li>
              ))}
              {r.items.length === 0 && <li className="px-4 py-6 text-center text-sm text-slate-400">{r.year}年に納める源泉所得税・住民税はありません(給料の計上や報酬の源泉徴収を記録すると出ます)</li>}
            </ul>
          </div>
          <p className="text-xs text-slate-500">
            毎月納付は支払った月の翌月10日、納期の特例は源泉所得税が7月10日と1月20日、住民税が12月10日と6月10日が期限です(土日は次の月曜日。祝日は考えていません)。
            納期の特例が使えるのは給料と士業の報酬だけで、ほかの報酬は毎月納めます。納めたお金は、銀行明細を取り込むと「預り金」で記帳されます。
          </p>
        </div>
      )}

      {tab === "fees" && data && (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            個人のデザイナー・ライター・講師・税理士などに報酬を払うときは、源泉所得税(100万円まで10.21%、超えた分は20.42%)を差し引いて払い、翌月10日までに納めます。
            受け取った請求書に記録すると「買掛金 / 預り金」の仕訳を作り、請求書の残り(振り込む額)が差し引いた後の額になります。
          </p>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <ul className="divide-y">
              {data.fees.map((f) => {
                const form = formOf(f);
                return (
                  <li key={f.id} className="space-y-2 px-4 py-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="font-medium">{f.vendorName}</span>
                        <span className="ml-2 text-xs text-slate-500">
                          {f.invoiceNumber ?? "番号なし"} ・ {f.issueDate ? slash(f.issueDate) : ""} ・ 請求額 {formatYen(f.total)}
                        </span>
                      </div>
                      <span className="text-xs text-slate-500">残り {formatYen(f.remaining)}</span>
                    </div>
                    {f.withholdings.length ? (
                      f.withholdings.map((w) => (
                        <div key={w.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-slate-50 px-3 py-2 text-xs">
                          <span>
                            源泉徴収 {formatYen(w.amount)}(報酬 {formatYen(w.base ?? 0)}・{CATEGORY_LABEL[w.category ?? ""] ?? ""}・{slash(w.date)})
                          </span>
                          <button onClick={() => post({ action: "delete", paymentId: w.id }, "源泉徴収の記録を消しました")} disabled={busy} className="text-rose-600 hover:underline">
                            消す
                          </button>
                        </div>
                      ))
                    ) : (
                      <div className="flex flex-wrap items-end gap-2">
                        <label className="text-xs">
                          <span className="text-slate-500">報酬の種類</span>
                          <select value={form.category} onChange={(e) => setForm(f, { category: e.target.value })} className="mt-1 block rounded-md border px-2 py-1.5 text-sm">
                            {CATEGORIES.map(([k, l]) => (
                              <option key={k} value={k}>
                                {l}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="text-xs">
                          <span className="text-slate-500">報酬の額(税抜)</span>
                          <input value={form.base} onChange={(e) => setForm(f, { base: e.target.value })} inputMode="numeric" className="mt-1 block w-28 rounded-md border px-2 py-1.5 text-sm" />
                        </label>
                        <label className="text-xs">
                          <span className="text-slate-500">源泉徴収税額</span>
                          <input value={form.amount} onChange={(e) => setForm(f, { amount: e.target.value })} inputMode="numeric" className="mt-1 block w-24 rounded-md border px-2 py-1.5 text-sm" />
                        </label>
                        <label className="text-xs">
                          <span className="text-slate-500">支払日</span>
                          <input type="date" value={form.date} onChange={(e) => setForm(f, { date: e.target.value })} className="mt-1 block rounded-md border px-2 py-1.5 text-sm" />
                        </label>
                        <button
                          onClick={() => post({ action: "record", invoiceId: f.id, ...form }, `${f.vendorName}の源泉徴収を記録しました`)}
                          disabled={busy}
                          className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                        >
                          源泉徴収を記録
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
              {data.fees.length === 0 && <li className="px-4 py-6 text-center text-sm text-slate-400">{year}年に受け取った請求書はありません</li>}
            </ul>
          </div>
          <p className="text-xs text-slate-500">会社(法人)への支払いは、ふつう源泉徴収しません。個人への支払いのうち、報酬・料金にあたるものだけ記録してください。</p>
        </div>
      )}

      {tab === "statements" && s && (
        <div className="space-y-4">
          <section className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-sm font-semibold">給与所得の源泉徴収票(合計)</div>
              <div className="mt-2 text-sm text-slate-600">
                {s.summary.salary.people}人 ・ 支払金額 {formatYen(s.summary.salary.amount)} ・ 源泉徴収税額 {formatYen(s.summary.salary.tax)}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-sm font-semibold">報酬、料金、契約金及び賞金の支払調書(合計)</div>
              <div className="mt-2 text-sm text-slate-600">
                {s.summary.fee.people}人 ・ 支払金額 {formatYen(s.summary.fee.amount)} ・ 源泉徴収税額 {formatYen(s.summary.fee.tax)}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                うち提出が必要(年5万円超): {s.summary.fee.submitPeople}人 ・ {formatYen(s.summary.fee.submitAmount)} ・ {formatYen(s.summary.fee.submitTax)}
              </div>
            </div>
          </section>
          <p className="text-xs text-slate-500">上の数字は「給与所得の源泉徴収票等の法定調書合計表」の記入に使えます。翌年1月31日までに税務署へ出します。</p>

          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <h2 className="border-b px-4 py-3 font-semibold">報酬の支払調書({s.year}年)</h2>
            <ul className="divide-y text-sm">
              {s.fees.map((f) => (
                <li key={f.vendorId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="font-medium">
                      {f.name}
                      {f.mustSubmit && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">提出が必要</span>}
                    </div>
                    <div className="text-xs text-slate-500">
                      {f.categories.join("・")} ・ {f.count}回 ・ 住所 {f.address ?? "未登録"}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="text-right text-xs">
                      <div>
                        支払金額 <span className="font-semibold tabular-nums">{formatYen(f.base)}</span>
                      </div>
                      <div>
                        源泉徴収税額 <span className="font-semibold tabular-nums">{formatYen(f.tax)}</span>
                      </div>
                    </div>
                    {f.vendorId !== "none" && (
                      <>
                        <button
                          onClick={() => {
                            const address = prompt(`${f.name}の住所(支払調書に載せます)`, f.address ?? "");
                            if (address !== null) post({ action: "address", vendorId: f.vendorId, address }, "住所を保存しました");
                          }}
                          className="text-xs text-indigo-700 hover:underline"
                        >
                          住所
                        </button>
                        <Link href={`/withholding/statement?year=${s.year}&vendorId=${f.vendorId}`} className="text-xs text-indigo-700 hover:underline">
                          支払調書を印刷
                        </Link>
                      </>
                    )}
                  </div>
                </li>
              ))}
              {s.fees.length === 0 && <li className="px-4 py-6 text-center text-slate-400">{s.year}年に源泉徴収した報酬はありません</li>}
            </ul>
          </section>

          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <h2 className="border-b px-4 py-3 font-semibold">給料の人別の合計({s.year}年に支払った分)</h2>
            <ul className="divide-y text-sm">
              {s.salaries.map((x) => (
                <li key={x.name} className="flex flex-wrap justify-between gap-2 px-4 py-2">
                  <span>{x.name}</span>
                  <span className="text-xs tabular-nums">
                    支払金額 {formatYen(x.gross)} ・ 源泉徴収税額 {formatYen(x.incomeTax)}
                  </span>
                </li>
              ))}
              {s.salaries.length === 0 && <li className="px-4 py-6 text-center text-slate-400">この年に支払った給料はありません</li>}
            </ul>
            <p className="border-t px-4 py-2 text-xs text-slate-500">支払金額は通勤手当(非課税分)を除いた額です。年末調整の結果は含みません。</p>
          </section>
        </div>
      )}
    </div>
  );
}

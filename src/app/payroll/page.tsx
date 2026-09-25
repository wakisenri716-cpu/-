"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { formatYen } from "@/lib/format";
import { PrintButton } from "@/components/PrintButton";

type Row = {
  staffId: string;
  name: string;
  days: number;
  taxColumn: string;
  dependents: number;
  wages: number;
  commute: number;
  gross: number;
  standardMonthly: number | null;
  standardEstimated: boolean;
  health: number;
  care: number;
  pension: number;
  employment: number;
  incomeTax: number;
  incomeTaxNeedsInput: boolean;
  incomeTaxOverridden: boolean;
  residentTax: number;
  totalDeductions: number;
  netPay: number;
  employerSocial: number;
};
type Staff = {
  id: string;
  name: string;
  dependents: number;
  taxColumn: string;
  socialInsurance: boolean;
  careInsurance: boolean;
  employmentInsurance: boolean;
  standardMonthly: number | null;
  commuteAllowance: number;
  residentTax: number;
};
type Rates = { health: number; care: number; pension: number; employment: number };
type Sheet = {
  month: string;
  rows: Row[];
  totals: Record<string, number>;
  settings: { prefecture: string; rates: Rates };
  posted: boolean;
  changedSincePost: boolean;
  staff: Staff[];
};

function currentMonth() {
  const d = new Date();
  // 給料はふつう前月分を計算するので、最初は先月を開く
  const prev = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;
}

function shift(month: string, delta: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const cell = "px-3 py-2 text-right tabular-nums whitespace-nowrap";
const RATE_LABELS: [keyof Rates, string][] = [
  ["health", "健康保険"],
  ["care", "介護保険(40〜64歳)"],
  ["pension", "厚生年金"],
  ["employment", "雇用保険(本人負担)"],
];

export default function PayrollPage() {
  const [month, setMonth] = useState(currentMonth);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Record<string, Staff>>({});
  const [taxInput, setTaxInput] = useState<Record<string, string>>({});
  const [rates, setRates] = useState<Record<string, string> | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/payroll/sheet?month=${month}`);
    const body = await res.json();
    if (!res.ok) return setMessage({ ok: false, text: body.error || "読み込めませんでした" });
    setSheet(body);
    setRates(null);
  }, [month]);

  useEffect(() => {
    // Fetch-on-mount/month change: setState always lands after the fetch's await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function call(url: string, method: string, body: unknown, ok: string) {
    setBusy(true);
    setMessage(null);
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setMessage({ ok: false, text: json.error || "処理に失敗しました" });
      return false;
    }
    setMessage({ ok: true, text: ok });
    await load();
    return true;
  }

  const [y, m] = month.split("-").map(Number);
  const t = sheet?.totals;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">給与計算</h1>
          <p className="mt-1 text-sm text-slate-600">
            シフト・タイムカードから出した給与に、社会保険料・雇用保険料・源泉所得税・住民税の控除をかけて、手取り(差引支給額)を計算します。
          </p>
        </div>
        <PrintButton variant="outline" />
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm print:hidden">
        <button type="button" onClick={() => setMonth(shift(month, -1))} className="rounded-md border px-2 py-1 hover:bg-slate-50" aria-label="前の月">
          ◀
        </button>
        <span className="text-lg font-semibold">
          {y}年{m}月分
        </span>
        <button type="button" onClick={() => setMonth(shift(month, 1))} className="rounded-md border px-2 py-1 hover:bg-slate-50" aria-label="次の月">
          ▶
        </button>
        {sheet?.posted && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">計上済み</span>}
      </div>

      {message && <div className={`rounded-md px-4 py-2 text-sm ${message.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"}`}>{message.text}</div>}

      <p className="rounded-md bg-amber-50 px-4 py-2 text-xs text-amber-900 print:hidden">
        計算は目安です。源泉所得税は国税庁の「電子計算機等を使用して源泉徴収税額を計算する方法」の式(令和8年分)で計算しています。税額表と違うときや乙欄の人は、税額の欄で直せます。
        標準報酬月額を入れていない人は、その月の支給額から等級を当てはめています(本来は4〜6月の平均で年1回決まります)。
      </p>

      {sheet === null ? (
        <p className="text-sm text-slate-500">読み込み中...</p>
      ) : (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs whitespace-nowrap text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">スタッフ</th>
                  <th className={cell}>給与</th>
                  <th className={cell}>通勤手当</th>
                  <th className={cell}>健康保険</th>
                  <th className={cell}>介護保険</th>
                  <th className={cell}>厚生年金</th>
                  <th className={cell}>雇用保険</th>
                  <th className={cell}>源泉所得税</th>
                  <th className={cell}>住民税</th>
                  <th className={cell}>控除計</th>
                  <th className={`${cell} text-slate-700`}>差引支給額</th>
                  <th className="px-3 py-2 print:hidden" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {sheet.rows.map((r) => (
                  <tr key={r.staffId} className="align-top">
                    <td className="px-3 py-2 whitespace-nowrap">
                      <div className="font-medium">{r.name}</div>
                      <div className="text-xs text-slate-500">
                        {r.days}日・{r.taxColumn === "OTSU" ? "乙欄" : `甲欄 扶養${r.dependents}人`}
                        {r.standardMonthly !== null && ` ・標準報酬 ${(r.standardMonthly / 1000).toLocaleString("ja-JP")}千円${r.standardEstimated ? "(目安)" : ""}`}
                      </div>
                    </td>
                    <td className={cell}>{formatYen(r.wages)}</td>
                    <td className={cell}>{r.commute ? formatYen(r.commute) : "-"}</td>
                    <td className={cell}>{r.health ? formatYen(r.health) : "-"}</td>
                    <td className={cell}>{r.care ? formatYen(r.care) : "-"}</td>
                    <td className={cell}>{r.pension ? formatYen(r.pension) : "-"}</td>
                    <td className={cell}>{r.employment ? formatYen(r.employment) : "-"}</td>
                    <td className={cell}>
                      {sheet.posted ? (
                        formatYen(r.incomeTax)
                      ) : (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            const v = taxInput[r.staffId];
                            call("/api/payroll/override", "PUT", { staffId: r.staffId, month, incomeTax: v === undefined || v === "" ? null : Number(v) }, `${r.name}さんの源泉所得税を${v ? "直しました" : "自動計算に戻しました"}`).then((ok) => {
                              if (ok) setTaxInput((prev) => ({ ...prev, [r.staffId]: undefined as unknown as string }));
                            });
                          }}
                          className="flex items-center justify-end gap-1"
                        >
                          <input
                            type="number"
                            min={0}
                            value={taxInput[r.staffId] ?? (r.incomeTaxNeedsInput ? "" : String(r.incomeTax))}
                            onChange={(e) => setTaxInput({ ...taxInput, [r.staffId]: e.target.value })}
                            className={`w-24 rounded border px-1.5 py-1 text-right text-sm ${r.incomeTaxNeedsInput ? "border-rose-400 bg-rose-50" : r.incomeTaxOverridden ? "border-indigo-300 bg-indigo-50" : ""}`}
                            aria-label={`${r.name}さんの源泉所得税`}
                            placeholder={r.incomeTaxNeedsInput ? "要入力" : ""}
                          />
                          {taxInput[r.staffId] !== undefined && (
                            <button type="submit" disabled={busy} className="rounded bg-indigo-600 px-1.5 py-1 text-xs text-white">
                              保存
                            </button>
                          )}
                          {r.incomeTaxOverridden && taxInput[r.staffId] === undefined && (
                            <button
                              type="button"
                              onClick={() => call("/api/payroll/override", "PUT", { staffId: r.staffId, month, incomeTax: null }, `${r.name}さんの源泉所得税を自動計算に戻しました`)}
                              className="text-[11px] text-indigo-700 hover:underline"
                              title="自動計算に戻す"
                            >
                              戻す
                            </button>
                          )}
                        </form>
                      )}
                      {r.incomeTaxNeedsInput && <div className="mt-0.5 text-[11px] text-rose-700">乙欄: 税額表で確認</div>}
                    </td>
                    <td className={cell}>{r.residentTax ? formatYen(r.residentTax) : "-"}</td>
                    <td className={cell}>{formatYen(r.totalDeductions)}</td>
                    <td className={`${cell} font-semibold`}>{formatYen(r.netPay)}</td>
                    <td className="px-3 py-2 whitespace-nowrap print:hidden">
                      <Link href={`/shifts/payslip?staffId=${r.staffId}&month=${month}`} className="text-xs text-indigo-700 hover:underline">
                        給与明細
                      </Link>
                    </td>
                  </tr>
                ))}
                {sheet.rows.length === 0 && (
                  <tr>
                    <td colSpan={12} className="px-4 py-6 text-center text-slate-400">
                      この月のシフト・打刻がありません。シフト管理で登録してください。
                    </td>
                  </tr>
                )}
              </tbody>
              {t && sheet.rows.length > 0 && (
                <tfoot className="border-t-2 bg-slate-50 font-semibold">
                  <tr>
                    <td className="px-3 py-2">合計</td>
                    {(["wages", "commute", "health", "care", "pension", "employment", "incomeTax", "residentTax", "totalDeductions", "netPay"] as const).map((k) => (
                      <td key={k} className={cell}>
                        {formatYen(t[k])}
                      </td>
                    ))}
                    <td className="print:hidden" />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          {t && sheet.rows.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-sm print:hidden">
              <span className="text-xs text-slate-600">
                会社負担の社会保険料 {formatYen(t.employerSocial)}(法定福利費として計上)
              </span>
              {sheet.posted ? (
                <span className="flex flex-wrap items-center gap-3">
                  {sheet.changedSincePost && <span className="text-xs text-amber-700">計上後にシフトが変わっています。取り消して計上し直してください。</span>}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => window.confirm(`${y}年${m}月分の給料の計上を取り消しますか?`) && call(`/api/payroll?month=${month}`, "DELETE", undefined, "計上を取り消しました")}
                    className="text-xs text-rose-600 hover:underline"
                  >
                    計上を取り消す
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => call("/api/payroll", "POST", { month }, `${y}年${m}月分の給料を計上しました(給料手当・預り金・未払金の仕訳)`)}
                  className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  この内容で給料を計上する
                </button>
              )}
            </div>
          )}
        </section>
      )}

      {sheet && (
        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm print:hidden">
          <div>
            <h2 className="font-semibold">スタッフごとの控除の設定</h2>
            <p className="mt-1 text-xs text-slate-500">
              扶養控除等申告書を出している人は「甲欄」、出していない人(掛け持ちの2か所目など)は「乙欄」です。住民税は市区町村から届く通知書の月額を入れてください。
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs whitespace-nowrap text-slate-500">
                <tr>
                  <th className="py-1 pr-3">スタッフ</th>
                  <th className="py-1 pr-3">税額表</th>
                  <th className="py-1 pr-3">扶養(人)</th>
                  <th className="py-1 pr-3">社会保険</th>
                  <th className="py-1 pr-3">介護保険</th>
                  <th className="py-1 pr-3">雇用保険</th>
                  <th className="py-1 pr-3">標準報酬月額</th>
                  <th className="py-1 pr-3">通勤手当/月</th>
                  <th className="py-1 pr-3">住民税/月</th>
                  <th />
                </tr>
              </thead>
              <tbody className="divide-y">
                {sheet.staff.map((s) => {
                  const e = editing[s.id] ?? s;
                  const set = (patch: Partial<Staff>) => setEditing({ ...editing, [s.id]: { ...e, ...patch } });
                  const dirty = !!editing[s.id];
                  const num = "w-24 rounded border px-1.5 py-1 text-right text-sm";
                  return (
                    <tr key={s.id} className="hover:bg-transparent">
                      <td className="py-1.5 pr-3 whitespace-nowrap">{s.name}</td>
                      <td className="py-1.5 pr-3">
                        <select value={e.taxColumn} onChange={(ev) => set({ taxColumn: ev.target.value })} className="rounded border px-1 py-1 text-sm" aria-label={`${s.name}さんの税額表`}>
                          <option value="KOU">甲欄</option>
                          <option value="OTSU">乙欄</option>
                        </select>
                      </td>
                      <td className="py-1.5 pr-3">
                        <input type="number" min={0} max={20} value={e.dependents} onChange={(ev) => set({ dependents: Number(ev.target.value) })} className="w-16 rounded border px-1.5 py-1 text-right text-sm" aria-label={`${s.name}さんの扶養人数`} />
                      </td>
                      <td className="py-1.5 pr-3 text-center">
                        <input type="checkbox" checked={e.socialInsurance} onChange={(ev) => set({ socialInsurance: ev.target.checked, careInsurance: ev.target.checked && e.careInsurance })} aria-label={`${s.name}さんの社会保険`} />
                      </td>
                      <td className="py-1.5 pr-3 text-center">
                        <input type="checkbox" checked={e.careInsurance} disabled={!e.socialInsurance} onChange={(ev) => set({ careInsurance: ev.target.checked })} aria-label={`${s.name}さんの介護保険`} />
                      </td>
                      <td className="py-1.5 pr-3 text-center">
                        <input type="checkbox" checked={e.employmentInsurance} onChange={(ev) => set({ employmentInsurance: ev.target.checked })} aria-label={`${s.name}さんの雇用保険`} />
                      </td>
                      <td className="py-1.5 pr-3">
                        <input
                          type="number"
                          min={0}
                          value={e.standardMonthly ?? ""}
                          placeholder="自動"
                          disabled={!e.socialInsurance}
                          onChange={(ev) => set({ standardMonthly: ev.target.value === "" ? null : Number(ev.target.value) })}
                          className={num}
                          aria-label={`${s.name}さんの標準報酬月額`}
                        />
                      </td>
                      <td className="py-1.5 pr-3">
                        <input type="number" min={0} value={e.commuteAllowance} onChange={(ev) => set({ commuteAllowance: Number(ev.target.value) })} className={num} aria-label={`${s.name}さんの通勤手当`} />
                      </td>
                      <td className="py-1.5 pr-3">
                        <input type="number" min={0} value={e.residentTax} onChange={(ev) => set({ residentTax: Number(ev.target.value) })} className={num} aria-label={`${s.name}さんの住民税`} />
                      </td>
                      <td className="py-1.5 whitespace-nowrap">
                        {dirty && (
                          <span className="flex gap-2">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={async () => {
                                const { id, name, ...patch } = e;
                                void id;
                                if (await call(`/api/payroll/staff/${s.id}`, "PATCH", patch, `${name}さんの設定を保存しました`)) {
                                  setEditing((prev) => {
                                    const next = { ...prev };
                                    delete next[s.id];
                                    return next;
                                  });
                                }
                              }}
                              className="rounded bg-indigo-600 px-2 py-1 text-xs text-white disabled:opacity-50"
                            >
                              保存
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setEditing((prev) => {
                                  const next = { ...prev };
                                  delete next[s.id];
                                  return next;
                                })
                              }
                              className="text-xs text-slate-500 hover:underline"
                            >
                              戻す
                            </button>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {sheet.staff.length === 0 && (
                  <tr>
                    <td colSpan={10} className="py-4 text-center text-slate-400">
                      スタッフがいません。シフト管理で登録してください。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {sheet.posted && <p className="text-xs text-slate-500">この月は計上済みのため、設定を変えても上の表は変わりません(来月以降の計算に使われます)。</p>}
        </section>
      )}

      {sheet && (
        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm print:hidden">
          <div>
            <h2 className="font-semibold">保険料率({sheet.settings.prefecture})</h2>
            <p className="mt-1 text-xs text-slate-500">
              健康保険・介護保険は労使折半(表の金額は本人負担分)、厚生年金は18.3%を折半です。健康保険料率は都道府県ごとに毎年3月ごろ、雇用保険料率は毎年4月ごろに見直されます。協会けんぽ・厚生労働省のホームページで最新の料率を確かめて直してください(変更は管理者のみ)。
            </p>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!rates) return;
              const { prefecture, ...r } = rates;
              call("/api/payroll/settings", "PUT", { prefecture, rates: r }, "保険料率を保存しました");
            }}
            className="flex flex-wrap items-end gap-3"
          >
            <label className="text-xs text-slate-500">
              都道府県
              <input
                value={rates?.prefecture ?? sheet.settings.prefecture}
                onChange={(e) => setRates({ ...(rates ?? toInputs(sheet.settings)), prefecture: e.target.value })}
                className="mt-1 block w-24 rounded border px-2 py-1.5 text-sm text-slate-900"
              />
            </label>
            {RATE_LABELS.map(([key, label]) => (
              <label key={key} className="text-xs text-slate-500">
                {label}(%)
                <input
                  type="number"
                  step="0.001"
                  min={0}
                  value={rates?.[key] ?? String(sheet.settings.rates[key] / 1000)}
                  onChange={(e) => setRates({ ...(rates ?? toInputs(sheet.settings)), [key]: e.target.value })}
                  className="mt-1 block w-28 rounded border px-2 py-1.5 text-right text-sm text-slate-900"
                />
              </label>
            ))}
            {rates && (
              <button type="submit" disabled={busy} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
                保存
              </button>
            )}
          </form>
        </section>
      )}
    </div>
  );
}

function toInputs(settings: Sheet["settings"]): Record<string, string> {
  return {
    prefecture: settings.prefecture,
    ...Object.fromEntries(Object.entries(settings.rates).map(([k, v]) => [k, String(v / 1000)])),
  };
}

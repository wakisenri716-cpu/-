"use client";

import { useState } from "react";
import type { JobCheck } from "@/lib/jobPosting";
import { PrintButton } from "@/components/PrintButton";

type Result = { catchphrase: string; rows: { label: string; text: string }[]; appeal: string; checks: JobCheck[]; mode: "claude" | "template" };

const TYPES = [
  ["PART", "パート・アルバイト"],
  ["CONTRACT", "契約社員"],
  ["REGULAR", "正社員"],
] as const;
const INSURANCES = ["雇用保険", "労災保険", "健康保険", "厚生年金"];
const LEVEL: Record<JobCheck["level"], { label: string; cls: string }> = {
  ng: { label: "直しましょう", cls: "border-rose-200 bg-rose-50 text-rose-900" },
  warn: { label: "足りない", cls: "border-amber-200 bg-amber-50 text-amber-900" },
  info: { label: "確かめる", cls: "border-slate-200 bg-slate-50 text-slate-700" },
};

export default function JobPostingView({ defaultWorkplace, ai }: { defaultWorkplace: string; ai: boolean }) {
  const [f, setF] = useState({
    title: "",
    type: "PART" as string,
    duties: "",
    workplace: defaultWorkplace,
    workplaceChange: "会社の定める場所",
    dutiesChange: "会社の定める業務",
    hours: "",
    holidays: "",
    wageType: "HOURLY" as "HOURLY" | "MONTHLY",
    wageMin: "",
    wageMax: "",
    allowances: "",
    trial: "なし",
    contract: "",
    insurances: ["労災保険"] as string[],
    appeal: "",
    apply: "",
    notes: "",
  });
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState<"template" | "ai" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<typeof f>) => setF((v) => ({ ...v, ...patch }));

  async function make(useAi: boolean) {
    setBusy(useAi ? "ai" : "template");
    setError(null);
    try {
      const res = await fetch("/api/job-posting", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...f, useAi }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "うまくいきませんでした");
      setResult(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "うまくいきませんでした");
    } finally {
      setBusy(null);
    }
  }

  const input = "mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm";
  const field = (key: keyof typeof f, label: string, placeholder = "", rows = 0) => (
    <label className="block text-sm">
      <span className="text-slate-700">{label}</span>
      {rows ? (
        <textarea value={f[key] as string} onChange={(e) => set({ [key]: e.target.value })} rows={rows} placeholder={placeholder} className={`${input} leading-6`} />
      ) : (
        <input value={f[key] as string} onChange={(e) => set({ [key]: e.target.value })} placeholder={placeholder} className={input} />
      )}
    </label>
  );

  return (
    <div className="space-y-6">
      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6 print:hidden">
        <div className="grid gap-4 sm:grid-cols-2">
          {field("title", "職種", "例: ホールスタッフ")}
          <label className="block text-sm">
            <span className="text-slate-700">雇用形態</span>
            <select value={f.type} onChange={(e) => set({ type: e.target.value })} className={input}>
              {TYPES.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <div className="sm:col-span-2">{field("duties", "仕事内容(メモでOK)", "例: 注文をとる、料理を運ぶ、レジ、閉店後の片付け", 3)}</div>
          {field("workplace", "就業場所")}
          {field("workplaceChange", "就業場所の変更の範囲")}
          {field("dutiesChange", "業務の変更の範囲")}
          {field("hours", "就業時間(休憩も)", "例: 10:00〜15:00(休憩なし)・週3日〜")}
          {field("holidays", "休日", "例: シフト制(週2日以上)")}
          <div className="text-sm">
            <span className="text-slate-700">賃金</span>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <select value={f.wageType} onChange={(e) => set({ wageType: e.target.value as "HOURLY" | "MONTHLY" })} className="rounded-md border border-slate-300 bg-white px-2 py-1.5">
                <option value="HOURLY">時給</option>
                <option value="MONTHLY">月給</option>
              </select>
              <input value={f.wageMin} onChange={(e) => set({ wageMin: e.target.value.replace(/[^\d]/g, "") })} inputMode="numeric" placeholder="下限" aria-label="賃金の下限" className="w-28 rounded-md border border-slate-300 px-2 py-1.5 text-right" />
              <span>〜</span>
              <input value={f.wageMax} onChange={(e) => set({ wageMax: e.target.value.replace(/[^\d]/g, "") })} inputMode="numeric" placeholder="上限(任意)" aria-label="賃金の上限" className="w-28 rounded-md border border-slate-300 px-2 py-1.5 text-right" />
              <span className="text-slate-500">円</span>
            </div>
          </div>
          {field("allowances", "手当(任意)", "例: 交通費支給(月1万円まで)")}
          {field("trial", "試用期間")}
          {f.type !== "REGULAR" && field("contract", "契約期間と更新", "例: 6か月(更新あり。勤務成績で判断)")}
          <fieldset className="text-sm sm:col-span-2">
            <legend className="text-slate-700">加入する保険</legend>
            <div className="mt-1 flex flex-wrap gap-4">
              {INSURANCES.map((x) => (
                <label key={x} className="inline-flex items-center gap-1.5">
                  <input type="checkbox" checked={f.insurances.includes(x)} onChange={(e) => set({ insurances: e.target.checked ? [...f.insurances, x] : f.insurances.filter((y) => y !== x) })} className="accent-indigo-700" />
                  {x}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="sm:col-span-2">{field("appeal", "職場のアピール(任意)", "例: 未経験の方も先輩がついて教えます。まかないあり。", 2)}</div>
          {field("apply", "応募方法(任意)", "例: 電話またはメールでご連絡ください")}
          {ai && field("notes", "AIに伝えること(任意)", "例: 落ち着いた雰囲気のカフェ。長く働ける人に来てほしい")}
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => make(false)} disabled={!!busy} className="rounded-md bg-vermilion-600 px-4 py-2 text-sm font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
            {busy === "template" ? "作っています…" : "下書きとチェック"}
          </button>
          {ai && (
            <button onClick={() => make(true)} disabled={!!busy} className="rounded-md border border-indigo-300 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50">
              {busy === "ai" ? "AIが書いています…" : "AIで仕事内容とアピールを書く"}
            </button>
          )}
        </div>
        {error && <p className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-800">{error}</p>}
      </section>

      {result && (
        <div className="space-y-4">
          {result.checks.length > 0 && (
            <ul className="space-y-2 print:hidden">
              {result.checks.map((c, i) => (
                <li key={i} className={`rounded-lg border px-3 py-2 text-sm ${LEVEL[c.level].cls}`}>
                  <span className="mr-2 font-medium">{LEVEL[c.level].label}</span>
                  {c.quote && <span className="mr-1">「{c.quote}」</span>}
                  {c.text}
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center justify-between print:hidden">
            <p className="text-sm text-slate-600">{result.mode === "claude" ? "AIが仕事内容とアピールを書きました。" : "入れた内容で作りました。"}内容を確かめてから使ってください。</p>
            <PrintButton variant="outline" />
          </div>
          <article className="mx-auto max-w-3xl space-y-4 rounded-xl border border-slate-200 bg-white p-6 text-sm leading-7 shadow-sm sm:p-10 print:max-w-none print:border-0 print:p-0 print:shadow-none">
            <h2 className="text-center text-xl font-semibold">求人票</h2>
            <p className="text-center font-medium text-indigo-900">{result.catchphrase}</p>
            <table className="w-full border-collapse">
              <tbody>
                {result.rows.map((r) => (
                  <tr key={r.label} className="align-top">
                    <th className="w-24 border border-slate-300 bg-slate-50 px-2 py-2 text-left font-medium sm:w-44 sm:px-3 sm:whitespace-nowrap">{r.label}</th>
                    <td className={`border border-slate-300 px-2 py-2 whitespace-pre-wrap sm:px-3 ${r.text === "(未入力)" ? "text-rose-700" : ""}`}>{r.text}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {result.appeal && (
              <section>
                <h3 className="font-semibold">職場のこと</h3>
                <p className="whitespace-pre-wrap">{result.appeal}</p>
              </section>
            )}
          </article>
        </div>
      )}
    </div>
  );
}

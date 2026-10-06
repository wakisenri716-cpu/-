"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { formatYen } from "@/lib/format";
import { calcYearEnd, type YearEndInputs, type YearEndResult } from "@/lib/payroll/yearEndTax";

type Data = {
  year: number;
  months: { from: string; to: string };
  staff: { id: string; name: string; taxColumn: string; dependents: number };
  paid: { pay: number; social: number; tax: number; payrollMonths: string[]; bonuses: string[] };
  reason: string | null;
  inputs: YearEndInputs;
  saved: boolean;
  finalizedAt: string | null;
  finalResult: YearEndResult | null;
};

const inputClass = "mt-1 w-full rounded-md border px-3 py-2 text-sm text-right tabular-nums disabled:bg-slate-50";
const amount = (v: number) => (v ? v.toLocaleString("ja-JP") : "");

function MoneyField({ label, hint, value, onChange, disabled }: { label: string; hint?: string; value: number; onChange: (v: number) => void; disabled: boolean }) {
  return (
    <label className="block text-sm">
      <span className="text-slate-600">{label}</span>
      <input
        inputMode="numeric"
        value={amount(value)}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value.replace(/[^\d]/g, "")) || 0)}
        placeholder="0"
        className={inputClass}
      />
      {hint && <span className="mt-0.5 block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}

function CountField({ label, hint, value, onChange, disabled }: { label: string; hint: string; value: number; onChange: (v: number) => void; disabled: boolean }) {
  return (
    <label className="block text-sm">
      <span className="text-slate-600">{label}</span>
      <select value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} className="mt-1 w-full rounded-md border px-3 py-2 text-sm disabled:bg-slate-50">
        {Array.from({ length: 11 }, (_, i) => (
          <option key={i} value={i}>
            {i}人
          </option>
        ))}
      </select>
      <span className="mt-0.5 block text-xs text-slate-400">{hint}</span>
    </label>
  );
}

export function StaffYearEnd({ staffId, year }: { staffId: string; year: number }) {
  const [data, setData] = useState<Data | null>(null);
  const [inputs, setInputs] = useState<YearEndInputs | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/year-end/${staffId}?year=${year}`);
    if (!res.ok) return setNotFound(true);
    const json: Data = await res.json();
    setData(json);
    setInputs(json.inputs);
  }, [staffId, year]);

  useEffect(() => {
    // Fetch-on-mount: setState always lands after the fetch's await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function call(method: string, body: object, done: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    const res = await fetch(`/api/year-end/${staffId}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ year, ...body }) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(json.error || "処理できませんでした");
      return false;
    }
    setMessage(done);
    await load();
    return true;
  }

  if (notFound) return <p className="text-sm text-slate-500">スタッフが見つかりません。</p>;
  if (!data || !inputs) return null;

  const locked = !!data.finalizedAt;
  const set = <K extends keyof YearEndInputs>(key: K) => (value: YearEndInputs[K]) => setInputs({ ...inputs, [key]: value });
  const r = data.finalResult ?? calcYearEnd(data.paid, inputs, data.year);
  const lines: [string, number, string?][] = [
    ["給与の支払金額", r.pay, inputs.prevPay ? "前の勤め先の分を含む" : undefined],
    ["給与所得控除後の金額", r.income],
    ["社会保険料等の控除", r.social],
    ["小規模企業共済等掛金の控除", r.smallBusiness],
    ["生命保険料の控除", r.lifeInsurance],
    ["地震保険料の控除", r.earthquakeInsurance],
    ["配偶者(特別)控除", r.spouse],
    ["扶養控除", r.dependents],
    ["基礎控除", r.basic],
    ["その他の控除", r.other],
    ["所得控除の合計", r.deductions],
    ["課税される所得(千円未満切捨て)", r.taxable],
    ["算出した所得税", r.computed],
    ["住宅ローン控除", r.housing],
    ["年税額(復興特別所得税を含む・百円未満切捨て)", r.annualTax],
    ["徴収した税額", r.withheld, inputs.prevTax ? "前の勤め先の分を含む" : undefined],
  ];

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <Link href={`/year-end?year=${data.year}`} className="text-sm text-indigo-700 hover:underline">
          ← 年末調整の一覧
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">
          {data.staff.name}さんの年末調整({data.year}年)
          {locked && <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 align-middle text-xs font-medium text-emerald-800">{data.finalizedAt} 確定</span>}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          支払った給料 {data.paid.payrollMonths.length}回{data.paid.bonuses.length ? `・賞与 ${data.paid.bonuses.join("・")}` : ""}。本人から出してもらった申告書を見ながら入力してください。右の計算は入力に合わせてすぐ変わります。
        </p>
      </div>

      {data.reason && <div className="rounded-md bg-slate-100 px-4 py-2 text-sm text-slate-700">この人は年末調整の対象外です({data.reason})。源泉徴収票には徴収した税額をそのまま載せます。</div>}
      {error && <div className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</div>}
      {message && <div className="rounded-md bg-emerald-50 px-4 py-2 text-sm text-emerald-800">{message}</div>}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-4">
          <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="font-semibold">扶養控除等申告書・配偶者控除等申告書</h2>
            <label className="block text-sm">
              <span className="text-slate-600">配偶者</span>
              <select value={inputs.spouse} disabled={locked} onChange={(e) => set("spouse")(e.target.value as YearEndInputs["spouse"])} className="mt-1 w-full rounded-md border px-3 py-2 text-sm disabled:bg-slate-50">
                <option value="none">控除なし</option>
                <option value="general">配偶者控除(38万円)</option>
                <option value="elderly">配偶者控除・70歳以上(48万円)</option>
                <option value="custom">配偶者特別控除など(金額を入力)</option>
              </select>
              <span className="mt-0.5 block text-xs text-slate-400">本人の合計所得が900万円を超えるときや、配偶者の所得が多いときは、配偶者控除等申告書の控除額を「金額を入力」で入れてください。</span>
            </label>
            {inputs.spouse === "custom" && <MoneyField label="配偶者(特別)控除の額" value={inputs.spouseAmount} onChange={set("spouseAmount")} disabled={locked} />}
            <div className="grid gap-3 sm:grid-cols-2">
              <CountField label="一般の扶養親族" hint="16歳以上(38万円)" value={inputs.dependentsGeneral} onChange={set("dependentsGeneral")} disabled={locked} />
              <CountField label="特定扶養親族" hint="19〜22歳(63万円)" value={inputs.dependentsSpecific} onChange={set("dependentsSpecific")} disabled={locked} />
              <CountField label="老人扶養親族(同居老親等以外)" hint="70歳以上(48万円)" value={inputs.dependentsElderly} onChange={set("dependentsElderly")} disabled={locked} />
              <CountField label="同居老親等" hint="同居する70歳以上の親など(58万円)" value={inputs.dependentsElderlyLiving} onChange={set("dependentsElderlyLiving")} disabled={locked} />
            </div>
            <MoneyField label="その他の控除" hint="障害者控除・寡婦控除・ひとり親控除・勤労学生控除・特定親族特別控除などの合計" value={inputs.otherDeductions} onChange={set("otherDeductions")} disabled={locked} />
          </section>

          <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="font-semibold">保険料控除申告書・住宅ローン控除</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <MoneyField label="生命保険料の控除額" hint="申告書で計算した控除額(最高12万円)" value={inputs.lifeInsurance} onChange={set("lifeInsurance")} disabled={locked} />
              <MoneyField label="地震保険料の控除額" hint="最高5万円" value={inputs.earthquakeInsurance} onChange={set("earthquakeInsurance")} disabled={locked} />
              <MoneyField label="本人が払った社会保険料" hint="国民年金・国民健康保険など(給料から引いた分は自動)" value={inputs.socialDeclared} onChange={set("socialDeclared")} disabled={locked} />
              <MoneyField label="小規模企業共済等掛金" hint="iDeCo(個人型確定拠出年金)など" value={inputs.smallBusiness} onChange={set("smallBusiness")} disabled={locked} />
              <MoneyField label="住宅借入金等特別控除額" hint="住宅ローン控除申告書の控除額(税額から引く)" value={inputs.housingLoan} onChange={set("housingLoan")} disabled={locked} />
            </div>
          </section>

          <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="font-semibold">前の勤め先の分(年の途中で入社した人)</h2>
            <p className="text-xs text-slate-500">前の勤め先の源泉徴収票の金額を入れます。</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <MoneyField label="支払金額" value={inputs.prevPay} onChange={set("prevPay")} disabled={locked} />
              <MoneyField label="社会保険料等の金額" value={inputs.prevSocial} onChange={set("prevSocial")} disabled={locked} />
              <MoneyField label="源泉徴収税額" value={inputs.prevTax} onChange={set("prevTax")} disabled={locked} />
            </div>
          </section>

          {!data.reason && (
            <div className="flex flex-wrap justify-end gap-2">
              {locked ? (
                <button
                  onClick={() => confirm("確定を取り消して、申告の内容を直せるようにしますか?") && call("POST", { action: "unfinalize" }, "確定を取り消しました")}
                  disabled={busy}
                  className="rounded-md border px-4 py-2 text-sm"
                >
                  確定を取り消す
                </button>
              ) : (
                <>
                  <button onClick={() => call("PUT", { inputs }, "申告の内容を保存しました")} disabled={busy} className="rounded-md border border-indigo-600 px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-50">
                    保存
                  </button>
                  <button
                    onClick={async () => {
                      if (!confirm("この内容で年末調整を確定しますか?確定すると源泉徴収票の税額になります")) return;
                      if (await call("PUT", { inputs }, "保存しました")) await call("POST", { action: "finalize" }, "年末調整を確定しました。源泉徴収票を印刷できます");
                    }}
                    disabled={busy}
                    className="rounded-md bg-vermilion-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-vermilion-700"
                  >
                    保存して確定
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        <aside className="space-y-3 self-start lg:sticky lg:top-4">
          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <h2 className="border-b px-4 py-3 font-semibold">計算{locked ? "(確定した内容)" : "(目安)"}</h2>
            <table className="w-full text-sm">
              <tbody className="divide-y">
                {lines.map(([label, value, note]) => (
                  <tr key={label} className={label.startsWith("年税額") || label === "所得控除の合計" ? "bg-slate-50 font-semibold" : ""}>
                    <td className="px-3 py-1.5">
                      {label}
                      {note && <span className="block text-[11px] font-normal text-slate-400">{note}</span>}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap">{formatYen(value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className={`px-4 py-3 text-center ${r.difference >= 0 ? "bg-emerald-50 text-emerald-900" : "bg-rose-50 text-rose-900"}`}>
              <p className="text-xs">{r.difference >= 0 ? "払いすぎ → 本人に返す(還付)" : "足りない → 給料から追加で差し引く(徴収)"}</p>
              <p className="text-2xl font-semibold tabular-nums">{formatYen(Math.abs(r.difference))}</p>
            </div>
          </section>
          <Link href={`/year-end/slips?year=${data.year}&staff=${data.staff.id}`} className="block rounded-md border border-slate-300 bg-white px-4 py-2 text-center text-sm hover:bg-slate-50">
            源泉徴収票を見る・印刷する
          </Link>
        </aside>
      </div>
    </div>
  );
}

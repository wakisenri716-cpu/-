"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { formatYen } from "@/lib/format";
import { calcCorporateTax, type CorporateTaxInput, type CorporateTaxResult } from "@/lib/accounting/corporateTaxCalc";

type Base = { revenue: number; expense: number; pretax: number; entertainment: number; capital: number; interim: number; bookedOther: number };
type Data = {
  fiscalYear: number;
  currentYear: number;
  from: string;
  to: string;
  inProgress: boolean;
  canPost: boolean;
  base: Base;
  input: CorporateTaxInput;
  result: CorporateTaxResult;
  posted: { at: string; by: string | null; total: number } | null;
};

const FIELDS: { key: keyof CorporateTaxInput; label: string; hint: string; suffix: string }[] = [
  { key: "addBack", label: "その他の加算", hint: "役員賞与・罰金・損金にならない租税公課など", suffix: "円" },
  { key: "deduction", label: "減算", hint: "受取配当の益金不算入・前期の事業税など", suffix: "円" },
  { key: "lossCarryforward", label: "使える繰越欠損金", hint: "前の年度までの赤字(10年以内)", suffix: "円" },
  { key: "perCapita", label: "住民税の均等割(年額)", hint: "多くの地域で資本金1千万円以下・従業員50人以下は7万円", suffix: "円" },
  { key: "months", label: "事業年度の月数", hint: "設立の年など12か月に満たないとき", suffix: "か月" },
];
const jp = (k: string) => {
  const [y, m, d] = k.split("-").map(Number);
  return `${y}年${m}月${d}日`;
};
const num = (v: string) => {
  const n = Number(v.normalize("NFKC").replace(/[,¥円\s]/g, "") || "0");
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
};

function Line({ label, amount, sub, strong, sign }: { label: string; amount: number; sub?: string; strong?: boolean; sign?: "+" | "−" }) {
  return (
    <tr className={strong ? "border-t border-slate-300 font-semibold" : ""}>
      <td className="py-1.5 pr-2">
        {sign && <span className="mr-1 text-slate-400">{sign}</span>}
        {label}
        {sub && <span className="block text-xs font-normal text-slate-500">{sub}</span>}
      </td>
      <td className="py-1.5 text-right whitespace-nowrap tabular-nums">{formatYen(amount)}</td>
    </tr>
  );
}

export function CorporateTaxView({ initialYear }: { initialYear: number | null }) {
  const [fy, setFy] = useState<number | null>(initialYear);
  const [data, setData] = useState<Data | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async (year: number | null) => {
    const res = await fetch(`/api/corporate-tax${year ? `?fy=${year}` : ""}`);
    if (!res.ok) return;
    const d: Data = await res.json();
    setData(d);
    setForm(Object.fromEntries(FIELDS.map((f) => [f.key, String(d.input[f.key])])));
  }, []);

  useEffect(() => {
    // Fetch-on-mount / 年度の切り替え: setState always lands after the fetch's await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(fy);
  }, [load, fy]);

  function move(year: number) {
    setMessage(null);
    setFy(year);
  }

  async function save(post: boolean) {
    if (!data) return;
    if (post && data.posted && !confirm("前に計上した仕訳を取消にして、この金額で計上し直しますか?")) return;
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/corporate-tax", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fy: data.fiscalYear, input: form, post }) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setMessage({ ok: false, text: json.error || "保存できませんでした" });
    setMessage({
      ok: true,
      text: post
        ? `${jp(data.to)}の日付で、法人税等 ${formatYen(json.total)} を計上しました(${json.payable >= 0 ? `未払法人税等 ${formatYen(json.payable)}` : `還付見込み ${formatYen(-json.payable)}`})。`
        : "入力を保存しました。",
    });
    await load(data.fiscalYear);
  }

  async function cancel() {
    if (!data || !confirm(`${data.fiscalYear}年度の法人税等の仕訳を取消にしますか?`)) return;
    setBusy(true);
    const res = await fetch(`/api/corporate-tax?fy=${data.fiscalYear}`, { method: "DELETE" });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    setMessage(res.ok ? { ok: true, text: "計上を取り消しました。" } : { ok: false, text: json.error || "取り消せませんでした" });
    await load(data.fiscalYear);
  }

  if (!data) return null;
  const b = data.base;
  const input: CorporateTaxInput = {
    addBack: num(form.addBack ?? "0"),
    deduction: num(form.deduction ?? "0"),
    lossCarryforward: num(form.lossCarryforward ?? "0"),
    perCapita: num(form.perCapita ?? "0"),
    months: Math.min(12, Math.max(1, num(form.months ?? "12") || 12)),
  };
  const r = calcCorporateTax(b, input);
  const payable = r.total - b.interim;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">法人税等の計算</h1>
        <p className="mt-1 text-sm text-slate-600">
          年度の税引前当期純利益から、法人税・地方法人税・住民税・事業税・特別法人事業税の目安を計算し、期末の日付で「法人税等 / 未払法人税等」の仕訳を作ります。決算書の「当期純利益」は税金を引いた後の金額になります。
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button onClick={() => move(data.fiscalYear - 1)} className="rounded-md border px-2 py-1 hover:bg-slate-50" aria-label="前の年度">
          ◀
        </button>
        <span className="font-medium">
          {data.fiscalYear}年度({jp(data.from)}〜{jp(data.to)})
        </span>
        <button onClick={() => move(data.fiscalYear + 1)} className="rounded-md border px-2 py-1 hover:bg-slate-50" aria-label="次の年度">
          ▶
        </button>
        {data.fiscalYear !== data.currentYear && (
          <button onClick={() => move(data.currentYear)} className="text-indigo-700 hover:underline">
            今期
          </button>
        )}
        {data.posted && (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
            計上済み {formatYen(data.posted.total)}({data.posted.at.replaceAll("-", "/")} {data.posted.by})
          </span>
        )}
      </div>

      {data.inProgress && <p className="rounded-md bg-amber-50 px-4 py-2 text-sm text-amber-900">この年度はまだ終わっていないため、今日までに記帳した数字での見込みです。減価償却などの決算整理を記帳してから計上してください。</p>}
      {b.bookedOther !== 0 && (
        <p className="rounded-md bg-amber-50 px-4 py-2 text-sm text-amber-900">
          この年度は、法人税等(5900)の科目にほかの仕訳が {formatYen(b.bookedOther)} 入っています。中間納付は「仮払法人税等(1240)」で記帳してください。
        </p>
      )}
      {message && <div className={`rounded-md px-4 py-2 text-sm ${message.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"}`}>{message.text}</div>}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold">計算のもと</h2>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <dt className="text-slate-600">収益の合計</dt>
            <dd className="text-right tabular-nums">{formatYen(b.revenue)}</dd>
            <dt className="text-slate-600">費用の合計(法人税等を除く)</dt>
            <dd className="text-right tabular-nums">{formatYen(b.expense)}</dd>
            <dt className="font-medium">税引前当期純利益</dt>
            <dd className={`text-right font-medium tabular-nums ${b.pretax < 0 ? "text-rose-700" : ""}`}>{formatYen(b.pretax)}</dd>
            <dt className="text-slate-600">資本金</dt>
            <dd className="text-right tabular-nums">
              {formatYen(b.capital)}
              <span className="block text-xs text-slate-500">{r.small ? "中小法人(1億円以下)の税率" : "1億円超(外形標準課税の対象)"}</span>
            </dd>
            <dt className="text-slate-600">中間納付(仮払法人税等)</dt>
            <dd className="text-right tabular-nums">{formatYen(b.interim)}</dd>
          </dl>
          <div className="space-y-3 border-t pt-3 text-sm">
            {FIELDS.map((f) => (
              <label key={f.key} className="flex items-center justify-between gap-3">
                <span>
                  {f.label}
                  <span className="block text-xs text-slate-500">{f.hint}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <input
                    value={form[f.key] ?? ""}
                    onChange={(e) => setForm((p) => ({ ...p, [f.key]: e.target.value }))}
                    inputMode="numeric"
                    aria-label={f.label}
                    className={`${f.key === "months" ? "w-16" : "w-32"} rounded-md border px-2 py-1.5 text-right tabular-nums`}
                  />
                  {f.suffix}
                </span>
              </label>
            ))}
          </div>
        </section>

        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold">税額の目安</h2>
          <table className="w-full text-sm">
            <tbody>
              <Line label="税引前当期純利益" amount={b.pretax} />
              {r.entertainmentExcess > 0 && (
                <Line sign="+" label="交際費の損金不算入" amount={r.entertainmentExcess} sub={r.small ? `接待交際費 ${formatYen(b.entertainment)} のうち年${formatYen(r.entertainmentLimit)}を超える分` : "接待交際費の半分"} />
              )}
              {input.addBack > 0 && <Line sign="+" label="その他の加算" amount={input.addBack} />}
              {input.deduction > 0 && <Line sign="−" label="減算" amount={input.deduction} />}
              {r.lossUsed > 0 && <Line sign="−" label="繰越欠損金の控除" amount={r.lossUsed} />}
              <Line label="課税所得(千円未満切り捨て)" amount={r.taxable} strong />
            </tbody>
          </table>
          <table className="w-full text-sm">
            <tbody>
              <Line label="法人税" amount={r.corporate} sub={r.small ? "年800万円以下の部分 15%・超える部分 23.2%" : "23.2%"} />
              <Line label="地方法人税" amount={r.localCorporate} sub="法人税の10.3%" />
              <Line label="住民税(法人税割)" amount={r.inhabitantLevy} sub="法人税の7.0%(標準税率)" />
              <Line label="住民税(均等割)" amount={r.perCapita} sub="赤字でもかかります" />
              <Line label="事業税(所得割)" amount={r.enterprise} sub={r.small ? "3.5%・5.3%・7.0%(標準税率)" : "1.0%(付加価値割・資本割は含みません)"} />
              <Line label="特別法人事業税" amount={r.specialEnterprise} sub={r.small ? "事業税の37%" : "事業税の260%"} />
              <Line label="法人税等の合計" amount={r.total} strong />
            </tbody>
          </table>
          {r.rate !== null && <p className="text-xs text-slate-500">税引前当期純利益に対する割合: {(r.rate * 100).toFixed(1)}%</p>}
          <dl className="grid grid-cols-2 gap-y-1 rounded-lg bg-slate-50 p-3 text-sm">
            <dt className="text-slate-600">中間納付</dt>
            <dd className="text-right tabular-nums">−{formatYen(b.interim)}</dd>
            <dt className="font-semibold">{payable >= 0 ? "確定申告で納める見込み" : "還付される見込み"}</dt>
            <dd className="text-right font-semibold tabular-nums">{formatYen(Math.abs(payable))}</dd>
          </dl>
          <div className="space-y-2">
            <button
              disabled={busy || !data.canPost || b.bookedOther !== 0 || (r.total === 0 && b.interim === 0)}
              onClick={() => save(true)}
              className="w-full rounded-md bg-vermilion-600 px-4 py-2 font-medium text-white hover:bg-vermilion-700 disabled:opacity-50"
            >
              {data.posted ? "この金額で計上し直す" : `${jp(data.to)}の日付で計上する`}
            </button>
            {!data.canPost && <p className="text-xs text-slate-500">期末の月({Number(data.to.slice(5, 7))}月)になったら計上できます。</p>}
            <div className="flex gap-2">
              <button disabled={busy} onClick={() => save(false)} className="flex-1 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                入力だけ保存する
              </button>
              {data.posted && (
                <button disabled={busy} onClick={cancel} className="flex-1 rounded-md border border-rose-300 px-4 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50">
                  計上を取り消す
                </button>
              )}
            </div>
          </div>
        </section>
      </div>

      <div className="space-y-1 text-xs text-slate-500">
        <p>・標準税率での目安です。都道府県・市町村の超過税率、税額控除(賃上げ促進税制など)、外形標準課税の付加価値割・資本割は含みません。申告の前に税理士に確認してもらってください。</p>
        <p>・仕訳は「法人税等 / 仮払法人税等(中間納付)・未払法人税等(残り)」です。翌期に納めたときは「未払法人税等 / 普通預金」で記帳します。</p>
        <p>
          ・計上すると、<Link href={`/financial-statements?fy=${data.fiscalYear}`} className="text-indigo-700 hover:underline">決算報告書</Link>の損益計算書に「法人税、住民税及び事業税」が入り、当期純利益が税引後の金額になります。
        </p>
      </div>
    </div>
  );
}

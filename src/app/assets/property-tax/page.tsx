"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { formatYen } from "@/lib/format";
import { PrintButton } from "@/components/PrintButton";

type Status = "taxable" | "excluded" | "small" | "notYet" | "disposed";
type Row = {
  id: string;
  name: string;
  acquired: string;
  disposed: string | null;
  cost: number;
  life: number;
  type: string | null;
  status: Status;
  increased: boolean;
  decreased: boolean;
  rate: number;
  value: number;
};
type TypeRow = { key: string; label: string; before: number; decrease: number; increase: number; total: number; value: number; count: number };
type Data = { year: number; reiwa: number; rows: Row[]; byType: TypeRow[]; summary: { base: number; exempt: boolean; estimatedTax: number; unclassified: number; count: number } };

const TYPES = [
  { key: "1", label: "1 構築物" },
  { key: "2", label: "2 機械及び装置" },
  { key: "3", label: "3 船舶" },
  { key: "4", label: "4 航空機" },
  { key: "5", label: "5 車両及び運搬具" },
  { key: "6", label: "6 工具・器具及び備品" },
  { key: "EXCLUDED", label: "対象外(建物・自動車税の車・ソフトウェアなど)" },
];
const STATUS_LABEL: Record<Exclude<Status, "taxable">, string> = {
  excluded: "対象外",
  small: "10万円未満のため申告しない",
  notYet: "1月2日以降に取得(翌年から)",
  disposed: "前年より前に売却・除却",
};
const num = (v: number) => (v ? v.toLocaleString("ja-JP") : "");
function wareki(date: string) {
  const [y, m] = date.split("-").map(Number);
  if (y >= 2019) return `R${y - 2018}.${m}`;
  if (y >= 1989) return `H${y - 1988}.${m}`;
  return `S${y - 1925}.${m}`;
}

export default function PropertyTaxPage() {
  const [year, setYear] = useState<number | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/property-tax${year ? `?year=${year}` : ""}`);
    if (res.ok) setData(await res.json());
  }, [year]);

  useEffect(() => {
    // Fetch-on-mount: setState always lands after the fetch's await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function setType(row: Row, taxAssetType: string) {
    setError(null);
    const res = await fetch(`/api/property-tax/${row.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ taxAssetType }) });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error || "保存できませんでした");
    await load();
  }

  if (!data) return null;
  const s = data.summary;
  const target = data.rows.filter((r) => r.status === "taxable");
  const others = data.rows.filter((r) => r.status !== "taxable");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div>
          <Link href="/assets" className="text-sm text-indigo-700 hover:underline">
            ← 固定資産管理
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">償却資産申告(固定資産税)</h1>
          <p className="mt-1 text-sm text-slate-600">
            毎年1月1日に持っている事業用の資産(パソコン・机・機械・内装など)を、1月31日までに会社のある市区町村へ申告します。固定資産の台帳から、申告書に書く金額と評価額の目安を出します。
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setYear(data.year - 1)} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50">
            ← 令和{data.reiwa - 1}年度
          </button>
          <button onClick={() => setYear(data.year + 1)} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50">
            令和{data.reiwa + 1}年度 →
          </button>
          <PrintButton variant="outline" />
        </div>
      </div>

      <h2 className="hidden text-xl font-semibold print:block">令和{data.reiwa}年度 償却資産申告の明細(目安)</h2>
      <p className="text-sm font-medium text-slate-800">
        令和{data.reiwa}年度({data.year}年1月1日現在)・申告期限 {data.year}年1月31日
      </p>

      {error && <div className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-700 print:hidden">{error}</div>}
      {s.unclassified > 0 && (
        <div className="rounded-md bg-amber-50 px-4 py-2 text-sm text-amber-900 print:hidden">
          資産の種類を決めていない資産が{s.unclassified}件あります(仮に「工具・器具及び備品」で数えています)。下の表で種類を選んでください。
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "申告する資産", value: `${s.count}件` },
          { label: "評価額の合計(課税標準額)", value: formatYen(s.base) },
          { label: "免税点(150万円)", value: s.exempt ? "未満(課税されない)" : "以上(課税される)" },
          { label: "固定資産税の目安(1.4%)", value: formatYen(s.estimatedTax) },
        ].map((t) => (
          <div key={t.label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs text-slate-500">{t.label}</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{t.value}</p>
          </div>
        ))}
      </div>
      {s.exempt && s.count > 0 && (
        <p className="rounded-md bg-slate-50 px-4 py-2 text-sm text-slate-700">
          課税標準額が150万円未満でも、申告は必要です(税額が0円になります)。
        </p>
      )}

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <h2 className="border-b px-4 py-3 font-semibold">申告書に書く金額(資産の種類別・取得価額)</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm tabular-nums">
            <thead className="bg-slate-50 text-xs whitespace-nowrap text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left font-medium">資産の種類</th>
                <th className="px-3 py-2 text-right font-medium">前年前に取得(イ)</th>
                <th className="px-3 py-2 text-right font-medium">前年中に減少(ロ)</th>
                <th className="px-3 py-2 text-right font-medium">前年中に取得(ハ)</th>
                <th className="px-3 py-2 text-right font-medium">計 (イ−ロ+ハ)</th>
                <th className="px-3 py-2 text-right font-medium">評価額</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.byType.map((t) => (
                <tr key={t.key} className={t.total || t.decrease ? "" : "text-slate-400"}>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {t.key} {t.label}
                  </td>
                  <td className="px-3 py-2 text-right">{num(t.before)}</td>
                  <td className="px-3 py-2 text-right">{num(t.decrease)}</td>
                  <td className="px-3 py-2 text-right">{num(t.increase)}</td>
                  <td className="px-3 py-2 text-right font-medium">{num(t.total)}</td>
                  <td className="px-3 py-2 text-right">{num(t.value)}</td>
                </tr>
              ))}
              <tr className="bg-slate-50 font-semibold">
                <td className="px-3 py-2">合計</td>
                <td className="px-3 py-2 text-right">{num(data.byType.reduce((a, t) => a + t.before, 0))}</td>
                <td className="px-3 py-2 text-right">{num(data.byType.reduce((a, t) => a + t.decrease, 0))}</td>
                <td className="px-3 py-2 text-right">{num(data.byType.reduce((a, t) => a + t.increase, 0))}</td>
                <td className="px-3 py-2 text-right">{num(data.byType.reduce((a, t) => a + t.total, 0))}</td>
                <td className="px-3 py-2 text-right">{num(s.base)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <h2 className="border-b px-4 py-3 font-semibold">種類別明細(申告する資産)</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm tabular-nums">
            <thead className="bg-slate-50 text-xs whitespace-nowrap text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left font-medium">資産の種類</th>
                <th className="px-3 py-2 text-left font-medium">資産の名称</th>
                <th className="px-3 py-2 text-left font-medium">取得年月</th>
                <th className="px-3 py-2 text-right font-medium">取得価額</th>
                <th className="px-3 py-2 text-right font-medium">耐用年数</th>
                <th className="px-3 py-2 text-right font-medium">減価率</th>
                <th className="px-3 py-2 text-right font-medium">評価額</th>
                <th className="px-3 py-2 text-left font-medium">摘要</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {target.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2">
                    <select value={r.type ?? ""} onChange={(e) => setType(r, e.target.value)} className={`w-40 rounded border px-2 py-1 text-xs print:hidden ${r.type ? "" : "border-amber-400 bg-amber-50"}`}>
                      <option value="">(未分類)</option>
                      {TYPES.map((t) => (
                        <option key={t.key} value={t.key}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                    <span className="hidden print:inline">{r.type ?? "6"}</span>
                  </td>
                  <td className="px-3 py-2">{r.name}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{wareki(r.acquired)}</td>
                  <td className="px-3 py-2 text-right">{num(r.cost)}</td>
                  <td className="px-3 py-2 text-right">{r.life}年</td>
                  <td className="px-3 py-2 text-right">{r.rate.toFixed(3)}</td>
                  <td className="px-3 py-2 text-right">{r.decreased ? "" : num(r.value)}</td>
                  <td className="px-3 py-2 text-xs whitespace-nowrap">{r.decreased ? `減少(${r.disposed!.replaceAll("-", "/")} 売却・除却)` : r.increased ? "前年中に取得" : ""}</td>
                </tr>
              ))}
              {target.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-slate-400">
                    申告する資産がありません。固定資産管理で資産を登録すると、ここに出ます。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {others.length > 0 && (
        <details className="rounded-xl border border-slate-200 bg-white shadow-sm print:hidden">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium">申告しない資産({others.length}件)</summary>
          <ul className="divide-y border-t text-sm">
            {others.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                <span>
                  {r.name}
                  <span className="ml-2 text-xs text-slate-500">
                    {r.acquired.replaceAll("-", "/")} 取得・{formatYen(r.cost)}・{STATUS_LABEL[r.status as Exclude<Status, "taxable">]}
                  </span>
                </span>
                {r.status === "excluded" && (
                  <button onClick={() => setType(r, "")} className="text-xs text-indigo-700 hover:underline">
                    対象に戻す
                  </button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      <p className="text-xs text-slate-500">
        評価額は固定資産評価基準の減価率(1 − 0.1^(1/耐用年数))による目安です。前年中に取得した資産は半年分(r/2)だけ減価し、取得価額の5%が下限です。中小企業者等の特例(わがまち特例など)、市区町村ごとの様式・電子申告(eLTAX)は反映していません。申告書は市区町村の様式に、この金額を書き写して提出してください。
      </p>
    </div>
  );
}

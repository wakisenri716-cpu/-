"use client";

import Link from "next/link";
import { useState } from "react";

type Preview = { inputs: Record<string, number | string>; checks: string[]; categories: { name: string; category: string }[] };
type Item = { staffId: string; name: string; hasAccount: boolean; id: string | null; status: string; reply: string | null; submittedAt: string | null; data: { note?: string } | null; preview: Preview | null };
type Data = { year: number; items: Item[]; counts: { submitted: number; applied: number; returned: number; none: number } };
const STATUS: Record<string, [string, string]> = { NONE: ["まだ出していない", "bg-slate-100 text-slate-600"], SUBMITTED: ["確認待ち", "bg-amber-100 text-amber-900"], APPLIED: ["年末調整に入れた", "bg-emerald-100 text-emerald-800"], RETURNED: ["差し戻し中", "bg-rose-100 text-rose-800"] };
const AMOUNTS: [string, string][] = [
  ["lifeInsurance", "生命保険料控除"],
  ["earthquakeInsurance", "地震保険料控除"],
  ["socialDeclared", "社会保険料(本人払い)"],
  ["smallBusiness", "iDeCoなど"],
  ["housingLoan", "住宅ローン控除"],
  ["prevPay", "前の勤め先の支払金額"],
];

export default function FormsView({ initial }: { initial: Data }) {
  const [data, setData] = useState(initial);
  const [deadline, setDeadline] = useState("");
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  async function call(url: string, body?: unknown) {
    const res = await fetch(url, { method: body ? "POST" : "GET", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "うまくいきませんでした");
    return json;
  }
  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setError(null);
    setFlash(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "うまくいきませんでした");
    } finally {
      setBusy(null);
    }
  }
  const load = async () => setData(await call(`/api/year-end-forms?year=${data.year}`));
  const ask = () =>
    run("ask", async () => {
      const r = await call("/api/year-end-forms", { year: data.year, deadline });
      setFlash(`${r.asked}人にお願いしました(社内のお知らせとスマホの通知)`);
    });
  const apply = (i: Item) =>
    run(i.staffId, async () => {
      await call(`/api/year-end-forms/${i.id}`, { action: "apply" });
      setFlash(`${i.name}さんの申告を年末調整に入れました`);
      await load();
    });
  const back = (i: Item) =>
    run(i.staffId, async () => {
      await call(`/api/year-end-forms/${i.id}`, { action: "return", reason: reasons[i.staffId] ?? "" });
      setFlash(`${i.name}さんに差し戻しました`);
      await load();
    });

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
        <span className="font-semibold">{data.year}年分</span>
        <span className="text-slate-600">
          確認待ち {data.counts.submitted}人・入れた {data.counts.applied}人・差し戻し {data.counts.returned}人・まだ {data.counts.none}人
        </span>
        <label className="ml-auto flex items-center gap-1 text-xs text-slate-500">
          締め切り
          <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1 text-sm" />
        </label>
        <button onClick={ask} disabled={!!busy} className="rounded-md bg-vermilion-600 px-3 py-1.5 font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
          まだの人にお願いする
        </button>
      </section>
      {error && <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}
      {flash && <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{flash}</p>}

      <section className="space-y-3">
        {data.items.map((i) => (
          <div key={i.staffId} className="rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{i.name}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS[i.status]?.[1] ?? ""}`}>{STATUS[i.status]?.[0] ?? i.status}</span>
              {!i.hasAccount && <span className="text-xs text-slate-500">アカウントなし(紙で受け取ってください)</span>}
              {i.status === "APPLIED" && (
                <Link href={`/year-end/${i.staffId}?year=${data.year}`} className="ml-auto text-xs text-indigo-700 underline">
                  年末調整を開く
                </Link>
              )}
            </div>
            {i.preview && i.status !== "NONE" && (
              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                <div>
                  <h3 className="text-xs font-semibold text-slate-500">家族の区分(目安)</h3>
                  {i.preview.categories.length ? (
                    <ul className="mt-1 space-y-0.5">
                      {i.preview.categories.map((c, k) => (
                        <li key={k}>
                          {c.name}: <span className="text-slate-600">{c.category}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-slate-500">配偶者・扶養している家族はいません</p>
                  )}
                </div>
                <div>
                  <h3 className="text-xs font-semibold text-slate-500">控除の額(目安)</h3>
                  <ul className="mt-1 space-y-0.5">
                    {AMOUNTS.filter(([k]) => Number(i.preview!.inputs[k])).map(([k, label]) => (
                      <li key={k}>
                        {label}: {Number(i.preview!.inputs[k]).toLocaleString()}円
                      </li>
                    ))}
                    {!AMOUNTS.some(([k]) => Number(i.preview!.inputs[k])) && <li className="text-slate-500">ありません</li>}
                  </ul>
                </div>
                {!!i.preview.checks.length && (
                  <ul className="list-disc space-y-0.5 pl-5 text-xs text-amber-800 lg:col-span-2">
                    {i.preview.checks.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                )}
                {i.data?.note && <p className="text-xs text-slate-600 lg:col-span-2">本人から: {i.data.note}</p>}
                {i.reply && <p className="text-xs text-rose-700 lg:col-span-2">差し戻しの理由: {i.reply}</p>}
              </div>
            )}
            {i.status === "SUBMITTED" && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button onClick={() => apply(i)} disabled={!!busy} className="rounded-md bg-vermilion-600 px-3 py-1.5 font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
                  年末調整に入れる
                </button>
                <input value={reasons[i.staffId] ?? ""} onChange={(e) => setReasons({ ...reasons, [i.staffId]: e.target.value })} placeholder="差し戻す理由(例: 保険の控除証明書をください)" className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1.5" />
                <button onClick={() => back(i)} disabled={!!busy} className="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-50 disabled:opacity-50">
                  差し戻す
                </button>
              </div>
            )}
          </div>
        ))}
        {!data.items.length && <p className="text-sm text-slate-500">労働者名簿にスタッフがいません。</p>}
      </section>
    </div>
  );
}

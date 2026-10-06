"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { formatYen } from "@/lib/format";

type Policy = { dayTripAllowance: number; dailyAllowance: number; lodging: number; overseasDaily: number; overseasLodging: number; effectiveDate: string | null };
type Trip = { id: string; userName: string; destination: string; purpose: string; startDate: string; endDate: string; nights: number; overseas: boolean; allowance: number; lodging: number; expenseReportId: string | null };
type Data = { policy: Policy | null; trips: Trip[]; canEditPolicy: boolean };
type Preview = { days: number; nights: number; overseas: boolean; allowance: number; lodging: number };

const FIELDS: { key: keyof Omit<Policy, "effectiveDate">; label: string; hint: string }[] = [
  { key: "dayTripAllowance", label: "日帰り出張の日当", hint: "1日あたり" },
  { key: "dailyAllowance", label: "宿泊出張の日当", hint: "1日あたり" },
  { key: "lodging", label: "宿泊費", hint: "1泊あたり(定額)" },
  { key: "overseasDaily", label: "海外出張の日当", hint: "1日あたり" },
  { key: "overseasLodging", label: "海外出張の宿泊費", hint: "1泊あたり(定額)" },
];
const slash = (d: string) => d.replaceAll("-", "/");
const emptyTrip = { destination: "", purpose: "", startDate: "", endDate: "", nights: "", overseas: false };

export function TravelView() {
  const [data, setData] = useState<Data | null>(null);
  const [policy, setPolicy] = useState<Record<string, string>>({});
  const [trip, setTrip] = useState(emptyTrip);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string; reportId?: string } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/travel");
    if (!res.ok) return;
    const d: Data = await res.json();
    setData(d);
    if (d.policy) {
      const p = d.policy;
      setPolicy(Object.fromEntries([...FIELDS.map((f) => [f.key, String(p[f.key])]), ["effectiveDate", p.effectiveDate ? p.effectiveDate.slice(0, 10) : ""]]));
    }
  }, []);

  useEffect(() => {
    // Fetch-on-mount: setState always lands after the fetch's await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function savePolicy(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/travel/policy", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(policy) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setMessage({ ok: false, text: json.error || "保存できませんでした" });
    setMessage({ ok: true, text: "出張旅費規程の金額を保存しました。" });
    setPreview(null);
    await load();
  }

  function editTrip(patch: Partial<typeof emptyTrip>) {
    setTrip((t) => ({ ...t, ...patch }));
    setPreview(null);
  }

  async function calc(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/travel/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(trip) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setMessage({ ok: false, text: json.error || "計算できませんでした" });
    setPreview(json);
  }

  async function submit() {
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/travel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(trip) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setMessage({ ok: false, text: json.error || "経費精算に入れられませんでした" });
    setMessage({ ok: true, text: `日当・宿泊費 ${formatYen(json.total)} を経費精算に入れました。`, reportId: json.reportId });
    setTrip(emptyTrip);
    setPreview(null);
    await load();
  }

  if (!data) return null;
  const inputClass = "mt-1 w-full rounded-md border px-3 py-2";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">出張旅費・日当</h1>
        <p className="mt-1 text-sm text-slate-600">
          会社の出張旅費規程で決めた日当・宿泊費(定額)を、出張の日数・泊数から計算して経費精算に入れます。規程どおりの日当は、払う側の会社の経費(旅費交通費)になり、受け取る人には所得税がかかりません。
        </p>
      </div>

      {message && (
        <div className={`rounded-md px-4 py-2 text-sm ${message.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"}`}>
          {message.text}
          {message.reportId && (
            <Link href="/expenses" className="ml-2 font-medium underline">
              経費精算を開く
            </Link>
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold">出張を入れる</h2>
          {!data.policy ? (
            <p className="text-sm text-slate-500">{data.canEditPolicy ? "先に右の「出張旅費規程」で日当・宿泊費を決めてください。" : "出張旅費規程(日当・宿泊費)がまだ決まっていません。管理者に設定を頼んでください。"}</p>
          ) : (
            <form onSubmit={calc} className="space-y-3 text-sm">
              <label className="block">
                <span className="text-slate-600">行き先</span>
                <input value={trip.destination} onChange={(e) => editTrip({ destination: e.target.value })} maxLength={100} required placeholder="例: 大阪" className={inputClass} />
              </label>
              <label className="block">
                <span className="text-slate-600">目的</span>
                <input value={trip.purpose} onChange={(e) => editTrip({ purpose: e.target.value })} maxLength={200} required placeholder="例: 取引先の打ち合わせ" className={inputClass} />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-slate-600">出発日</span>
                  <input type="date" value={trip.startDate} onChange={(e) => editTrip({ startDate: e.target.value, endDate: trip.endDate && trip.endDate >= e.target.value ? trip.endDate : e.target.value })} required className={inputClass} />
                </label>
                <label className="block">
                  <span className="text-slate-600">帰着日</span>
                  <input type="date" value={trip.endDate} min={trip.startDate} onChange={(e) => editTrip({ endDate: e.target.value })} required className={inputClass} />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-slate-600">泊数</span>
                  <input value={trip.nights} onChange={(e) => editTrip({ nights: e.target.value })} inputMode="numeric" placeholder="空欄なら日数−1" className={inputClass} />
                </label>
                <label className="mt-6 flex items-center gap-2">
                  <input type="checkbox" checked={trip.overseas} onChange={(e) => editTrip({ overseas: e.target.checked })} />
                  海外出張
                </label>
              </div>
              <button disabled={busy} className="w-full rounded-md border border-indigo-600 px-4 py-2 font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50">
                日当・宿泊費を計算する
              </button>
              {preview && (
                <div className="space-y-2 rounded-lg bg-slate-50 p-3">
                  <p className="text-slate-600">
                    {preview.days}日・{preview.nights}泊{preview.overseas ? "(海外)" : preview.nights === 0 ? "(日帰り)" : ""}
                  </p>
                  <p className="flex justify-between">
                    <span>日当</span>
                    <span className="tabular-nums">{formatYen(preview.allowance)}</span>
                  </p>
                  <p className="flex justify-between">
                    <span>宿泊費</span>
                    <span className="tabular-nums">{formatYen(preview.lodging)}</span>
                  </p>
                  <p className="flex justify-between border-t pt-2 font-semibold">
                    <span>合計</span>
                    <span className="tabular-nums">{formatYen(preview.allowance + preview.lodging)}</span>
                  </p>
                  <button type="button" disabled={busy || preview.allowance + preview.lodging <= 0} onClick={submit} className="w-full rounded-md bg-vermilion-600 px-4 py-2 font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
                    経費精算に入れる
                  </button>
                  <p className="text-xs text-slate-500">交通費(電車・飛行機など)は実費なので、レシートを経費精算に別に入れてください。</p>
                </div>
              )}
            </form>
          )}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">出張旅費規程(日当・宿泊費)</h2>
            {data.policy && (
              <Link href="/travel/policy" className="text-sm text-indigo-700 hover:underline">
                規程の文書を見る・印刷する
              </Link>
            )}
          </div>
          {data.canEditPolicy ? (
            <form onSubmit={savePolicy} className="space-y-3 text-sm">
              {FIELDS.map((f) => (
                <label key={f.key} className="flex items-center justify-between gap-3">
                  <span>
                    {f.label}
                    <span className="block text-xs text-slate-500">{f.hint}</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <input value={policy[f.key] ?? ""} onChange={(e) => setPolicy((p) => ({ ...p, [f.key]: e.target.value }))} inputMode="numeric" placeholder="0" aria-label={f.label} className="w-28 rounded-md border px-2 py-1.5 text-right tabular-nums" />円
                  </span>
                </label>
              ))}
              <label className="flex items-center justify-between gap-3">
                <span>施行日</span>
                <input type="date" value={policy.effectiveDate ?? ""} onChange={(e) => setPolicy((p) => ({ ...p, effectiveDate: e.target.value }))} className="rounded-md border px-2 py-1.5" />
              </label>
              <button disabled={busy} className="w-full rounded-md bg-vermilion-600 px-4 py-2 font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
                規程の金額を保存する
              </button>
              <p className="text-xs text-slate-500">日当は、役員・従業員の全員に同じ基準で、世間一般の相場(同業・同規模の会社くらい)にしておくと、税務上も認められやすくなります。規程の文書は株主総会や取締役会の議事録と一緒に保管してください。</p>
            </form>
          ) : data.policy ? (
            <dl className="space-y-2 text-sm">
              {FIELDS.map((f) => (
                <div key={f.key} className="flex justify-between">
                  <dt>{f.label}</dt>
                  <dd className="tabular-nums">{formatYen(data.policy![f.key])}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-sm text-slate-500">まだ決まっていません。</p>
          )}
        </section>
      </div>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <h2 className="border-b px-4 py-2 text-sm font-semibold">{data.canEditPolicy ? "出張の記録" : "自分の出張の記録"}</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs whitespace-nowrap text-slate-500">
              <tr>
                <th className="px-3 py-2">期間</th>
                <th className="px-3 py-2">行き先・目的</th>
                {data.canEditPolicy && <th className="px-3 py-2">出張した人</th>}
                <th className="px-3 py-2 text-right">日当</th>
                <th className="px-3 py-2 text-right">宿泊費</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.trips.map((t) => (
                <tr key={t.id}>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {slash(t.startDate)}
                    {t.endDate !== t.startDate && `〜${slash(t.endDate).slice(5)}`}
                    <span className="block text-xs text-slate-500">
                      {t.nights}泊{t.overseas ? "・海外" : ""}
                    </span>
                  </td>
                  <td className="min-w-[10rem] px-3 py-2">
                    {t.destination}
                    <span className="block text-xs text-slate-500">{t.purpose}</span>
                  </td>
                  {data.canEditPolicy && <td className="px-3 py-2 whitespace-nowrap">{t.userName}</td>}
                  <td className="px-3 py-2 text-right tabular-nums">{formatYen(t.allowance)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatYen(t.lodging)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {t.expenseReportId && (
                      <Link href="/expenses" className="text-xs text-indigo-700 hover:underline">
                        経費精算
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
              {data.trips.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                    まだ出張の記録はありません。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

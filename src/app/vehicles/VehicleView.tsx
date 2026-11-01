"use client";

import Link from "next/link";
import { useState } from "react";

type Alert = { kind: string; text: string; overdue: boolean };
type Vehicle = { id: string; name: string; plate: string | null; inspectionDue: string | null; insuranceDue: string | null; serviceAtKm: number | null; odometer: number | null; monthTrips: number; monthKm: number; alerts: Alert[] };

const input = "mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm";
const ymd = (k: string | null) => (k ? `${Number(k.slice(0, 4))}/${Number(k.slice(5, 7))}/${Number(k.slice(8, 10))}` : "未入力");

export default function VehicleView({ initial }: { initial: Vehicle[] }) {
  const [vehicles, setVehicles] = useState(initial);
  const [editing, setEditing] = useState<{ id: string; plate: string; inspectionDue: string; insuranceDue: string; serviceAtKm: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!editing) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/vehicles/${editing.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(editing) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "保存できませんでした");
      setVehicles(data.vehicles);
      setEditing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存できませんでした");
    } finally {
      setBusy(false);
    }
  }

  if (!vehicles.length)
    return (
      <p className="rounded-xl border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-600">
        社用車がまだありません。<Link href="/bookings" className="text-indigo-700 underline">会議室・社用車の予約</Link>の「予約できるもの」で、種類を「社用車」にして登録してください。
      </p>
    );
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {vehicles.map((v) => (
        <section key={v.id} className={`space-y-3 rounded-xl border bg-white p-4 text-sm shadow-sm ${v.alerts.some((a) => a.overdue) ? "border-rose-300" : v.alerts.length ? "border-amber-300" : "border-slate-200"}`}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-semibold">
              {v.name}
              {v.plate && <span className="ml-2 text-xs font-normal text-slate-500">{v.plate}</span>}
            </h2>
            <span className="text-xs text-slate-500">
              メーター {v.odometer != null ? `${v.odometer.toLocaleString()}km` : "記録なし"}・今月 {v.monthTrips}回 {v.monthKm.toLocaleString()}km
            </span>
          </div>
          {v.alerts.length > 0 && (
            <ul className="space-y-1">
              {v.alerts.map((a) => (
                <li key={a.kind} className={`rounded-md px-3 py-1.5 text-xs ${a.overdue ? "bg-rose-50 text-rose-800" : "bg-amber-50 text-amber-900"}`}>
                  {a.overdue ? "⚠ " : ""}
                  {a.text}
                </li>
              ))}
            </ul>
          )}
          {editing?.id === v.id ? (
            <div className="space-y-2">
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="block text-xs text-slate-600">
                  ナンバー
                  <input value={editing.plate} onChange={(e) => setEditing({ ...editing, plate: e.target.value })} placeholder="例: 品川 300 あ 12-34" className={input} />
                </label>
                <label className="block text-xs text-slate-600">
                  次の点検のメーター(km)
                  <input inputMode="numeric" value={editing.serviceAtKm} onChange={(e) => setEditing({ ...editing, serviceAtKm: e.target.value })} placeholder="例: 15000" className={input} />
                </label>
                <label className="block text-xs text-slate-600">
                  車検の満了日
                  <input type="date" value={editing.inspectionDue} onChange={(e) => setEditing({ ...editing, inspectionDue: e.target.value })} className={input} />
                </label>
                <label className="block text-xs text-slate-600">
                  任意保険の満了日
                  <input type="date" value={editing.insuranceDue} onChange={(e) => setEditing({ ...editing, insuranceDue: e.target.value })} className={input} />
                </label>
              </div>
              {error && <p className="rounded-md bg-rose-50 px-3 py-2 text-rose-800">{error}</p>}
              <div className="flex gap-2">
                <button onClick={save} disabled={busy} className="rounded-md bg-vermilion-600 px-4 py-1.5 font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
                  {busy ? "保存しています…" : "保存する"}
                </button>
                <button onClick={() => setEditing(null)} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50">
                  やめる
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-end justify-between gap-2">
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                <dt className="text-slate-500">車検</dt>
                <dd>{ymd(v.inspectionDue)}</dd>
                <dt className="text-slate-500">任意保険</dt>
                <dd>{ymd(v.insuranceDue)}</dd>
                <dt className="text-slate-500">次の点検</dt>
                <dd>{v.serviceAtKm != null ? `${v.serviceAtKm.toLocaleString()}km` : "未入力"}</dd>
              </dl>
              <button
                onClick={() => {
                  setError(null);
                  setEditing({ id: v.id, plate: v.plate ?? "", inspectionDue: v.inspectionDue ?? "", insuranceDue: v.insuranceDue ?? "", serviceAtKm: v.serviceAtKm != null ? String(v.serviceAtKm) : "" });
                }}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs hover:bg-slate-50"
              >
                直す
              </button>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

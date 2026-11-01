"use client";

import { useState } from "react";

type Check = { id: string; date: string; timing: string; driverName: string; vehicle: string; bookingId: string | null; method: string; detected: boolean; value: string | null; checkerName: string; note: string | null; odometer: number | null; destination: string | null; checkedAt: string };
type CarBooking = { id: string; date: string; start: string; end: string; vehicle: string; driverName: string; title: string; before: Check | null; after: Check | null };
type Missing = { bookingId: string; date: string; vehicle: string; driverName: string; start: string; end: string; missing: ("BEFORE" | "AFTER")[] };
type Form = { timing: "BEFORE" | "AFTER"; driverId: string; driverName: string; vehicle: string; method: "FACE" | "VIDEO" | "PHONE"; value: string; detected: boolean; note: string; odometer: string; destination: string; bookingId?: string; label?: string };
type Trip = { date: string; vehicle: string; driverName: string; start: string | null; end: string | null; odometerStart: number | null; odometerEnd: number | null; distance: number | null; destination: string | null; detected: boolean };
type Total = { vehicle: string; trips: number; distance: number };

const TIMINGS = { BEFORE: "運転前", AFTER: "運転後" } as const;
const METHODS = { FACE: "対面", VIDEO: "カメラ・ビデオ通話", PHONE: "電話" } as const;
const input = "w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm";
const md = (k: string) => `${Number(k.slice(5, 7))}/${Number(k.slice(8, 10))}`;
const hm = (iso: string) => new Date(iso).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Tokyo" });
const blank: Form = { timing: "BEFORE", driverId: "", driverName: "", vehicle: "", method: "FACE", value: "", detected: false, note: "", odometer: "", destination: "" };

export default function AlcoholView({ today, initialBookings, initialMissing, initialChecks, users, cars, odometers = {}, initialTrips = [], initialTotals = [] }: { today: string; initialBookings: CarBooking[]; initialMissing: Missing[]; initialChecks: Check[]; users: { id: string; name: string }[]; cars: string[]; odometers?: Record<string, number>; initialTrips?: Trip[]; initialTotals?: Total[] }) {
  const [bookings, setBookings] = useState(initialBookings);
  const [missing, setMissing] = useState(initialMissing);
  const [checks, setChecks] = useState(initialChecks);
  const [form, setForm] = useState<Form | null>(null);
  const [trips, setTrips] = useState(initialTrips);
  const [totals, setTotals] = useState(initialTotals);
  const [lastKm, setLastKm] = useState(odometers);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ text: string; danger: boolean } | null>(null);

  // 予約から開くと、運転する人と車は予約のとおり
  const openFor = (b: { id: string; vehicle: string; driverName: string; date: string; start: string; end: string }, timing: "BEFORE" | "AFTER") => {
    // 出発のメーターは、その車の最後のメーターを入れておく
    setForm({ ...blank, timing, bookingId: b.id, vehicle: b.vehicle, driverName: b.driverName, odometer: timing === "BEFORE" && lastKm[b.vehicle] != null ? String(lastKm[b.vehicle]) : "", label: `${md(b.date)} ${b.start}〜${b.end} ${b.vehicle}(${b.driverName})` });
    setError(null);
    setFlash(null);
  };

  async function save() {
    if (!form) return;
    setBusy(true);
    setError(null);
    try {
      const body = form.bookingId ? { bookingId: form.bookingId, timing: form.timing, method: form.method, value: form.value, detected: form.detected, note: form.note, odometer: form.odometer, destination: form.destination } : { ...form, driverName: form.driverId ? "" : form.driverName };
      const res = await fetch("/api/alcohol-checks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "記録できませんでした");
      const c: Check = data.check;
      setChecks((list) => (c.date.slice(0, 7) === today.slice(0, 7) ? [c, ...list] : list));
      if (c.bookingId) {
        setBookings((list) => list.map((b) => (b.id === c.bookingId ? { ...b, [c.timing === "BEFORE" ? "before" : "after"]: c } : b)));
        setMissing((list) => list.map((m) => (m.bookingId === c.bookingId ? { ...m, missing: m.missing.filter((t) => t !== c.timing) } : m)).filter((m) => m.missing.length));
      }
      setFlash(c.detected ? { text: `${c.driverName}さんから酒気が検知されました(${c.value ?? "数値なし"} mg/L)。運転させないでください。記録は残しました。`, danger: true } : { text: `${c.driverName}さんの${TIMINGS[c.timing as "BEFORE"]}のチェックを記録しました(酒気帯びなし)`, danger: false });
      setForm(null);
      if (c.odometer != null) setLastKm((m) => ({ ...m, [c.vehicle]: c.odometer! }));
      // 運転日誌を読み直す
      const log = await fetch(`/api/alcohol-checks?month=${today.slice(0, 7)}`).then((r) => (r.ok ? r.json() : null));
      if (log) {
        setTrips(log.trips);
        setTotals(log.totals);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "記録できませんでした");
    } finally {
      setBusy(false);
    }
  }

  const badge = (c: Check | null, b: CarBooking, timing: "BEFORE" | "AFTER") =>
    c ? (
      <span className={`rounded-full px-2 py-0.5 text-xs ring-1 ${c.detected ? "bg-rose-50 text-rose-800 ring-rose-200" : "bg-emerald-50 text-emerald-800 ring-emerald-200"}`}>
        {TIMINGS[timing]} {hm(c.checkedAt)} {c.detected ? "酒気あり" : "なし"}
      </span>
    ) : (
      <button onClick={() => openFor(b, timing)} className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs hover:bg-slate-50">
        {TIMINGS[timing]}を記録
      </button>
    );

  return (
    <div className="space-y-6">
      {flash && <p className={`rounded-md px-3 py-2 text-sm ${flash.danger ? "bg-rose-600 font-medium text-white" : "bg-emerald-50 text-emerald-800"}`}>{flash.text}</p>}

      {missing.length > 0 && (
        <section className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 text-sm shadow-sm">
          <h2 className="font-semibold text-amber-900">記録が足りない社用車の予約(この7日)</h2>
          <ul className="mt-2 space-y-1.5">
            {missing.map((m) => (
              <li key={m.bookingId} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>
                  {md(m.date)} {m.start}〜{m.end} {m.vehicle}({m.driverName})
                </span>
                <span className="text-xs text-amber-800">{m.missing.map((t) => TIMINGS[t]).join("・")}がありません</span>
                <span className="ml-auto flex gap-2">
                  {m.missing.map((t) => (
                    <button key={t} onClick={() => openFor({ ...m, id: m.bookingId }, t)} className="rounded-md border border-amber-300 bg-white px-2.5 py-1 text-xs text-amber-900 hover:bg-amber-100">
                      {TIMINGS[t]}を記録
                    </button>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">今日の社用車の予約</h2>
          <button onClick={() => setForm({ ...blank })} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs hover:bg-slate-50">
            予約なしで記録する
          </button>
        </div>
        {bookings.length ? (
          <ul className="mt-2 divide-y divide-slate-100">
            {bookings.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span className="tabular-nums text-slate-600">
                  {b.start}〜{b.end}
                </span>
                <span className="font-medium">{b.vehicle}</span>
                <span>{b.driverName}</span>
                <span className="text-xs text-slate-500">{b.title}</span>
                <span className="ml-auto flex flex-wrap gap-2">
                  {badge(b.before, b, "BEFORE")}
                  {badge(b.after, b, "AFTER")}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-slate-500">今日の社用車の予約はありません。</p>
        )}
      </section>

      {form && (
        <section className="space-y-3 rounded-xl border border-indigo-200 bg-white p-4 text-sm shadow-sm">
          <h2 className="font-semibold">
            {TIMINGS[form.timing]}のチェック{form.label ? `: ${form.label}` : ""}
          </h2>
          <div className="grid gap-2 sm:grid-cols-3">
            <select aria-label="運転前・後" value={form.timing} onChange={(e) => setForm({ ...form, timing: e.target.value as Form["timing"] })} className={input}>
              <option value="BEFORE">運転前</option>
              <option value="AFTER">運転後</option>
            </select>
            {!form.bookingId && (
              <>
                <select aria-label="運転する人" value={form.driverId} onChange={(e) => setForm({ ...form, driverId: e.target.value })} className={input}>
                  <option value="">運転する人(下に名前を書く)</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
                {!form.driverId && <input aria-label="運転する人の名前" placeholder="運転する人の名前" value={form.driverName} onChange={(e) => setForm({ ...form, driverName: e.target.value })} className={input} />}
                <input aria-label="車" list="alcohol-cars" placeholder="車(名前かナンバー)" value={form.vehicle} onChange={(e) => setForm({ ...form, vehicle: e.target.value })} className={input} />
                <datalist id="alcohol-cars">
                  {cars.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </>
            )}
            <select aria-label="確認の方法" value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value as Form["method"] })} className={input}>
              {Object.entries(METHODS).map(([k, v]) => (
                <option key={k} value={k}>
                  確認: {v}
                </option>
              ))}
            </select>
            <input aria-label="検知器の数値" inputMode="decimal" placeholder="検知器の数値 mg/L(例: 0.00)" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} className={input} />
            <input aria-label="メーター" inputMode="numeric" placeholder={form.timing === "BEFORE" ? "出発時のメーター km(任意)" : "帰着時のメーター km(任意)"} value={form.odometer} onChange={(e) => setForm({ ...form, odometer: e.target.value })} className={input} />
            {form.timing === "BEFORE" && <input aria-label="行き先" placeholder="行き先(任意)" value={form.destination} onChange={(e) => setForm({ ...form, destination: e.target.value })} className={input} />}
            <input aria-label="メモ" placeholder="メモ(任意)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className={input} />
          </div>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={form.detected} onChange={(e) => setForm({ ...form, detected: e.target.checked })} />
            <span>酒気帯びあり(顔色・におい・受け答えなどで気になるときも)</span>
          </label>
          {error && <p className="rounded-md bg-rose-50 px-3 py-2 text-rose-800">{error}</p>}
          <div className="flex gap-2">
            <button onClick={save} disabled={busy} className="rounded-md bg-vermilion-600 px-4 py-2 font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
              {busy ? "記録しています…" : "記録する"}
            </button>
            <button onClick={() => setForm(null)} className="rounded-md border border-slate-300 bg-white px-3 py-2 hover:bg-slate-50">
              やめる
            </button>
          </div>
        </section>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">今月の運転日誌({trips.length}回)</h2>
          <a href={`/api/alcohol-checks?month=${today.slice(0, 7)}&format=log-csv`} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs hover:bg-slate-50">
            運転日誌をCSVで出す
          </a>
        </div>
        {totals.length > 0 && (
          <p className="mt-2 flex flex-wrap gap-2">
            {totals.map((t) => (
              <span key={t.vehicle} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700">
                {t.vehicle}: {t.trips}回・{t.distance.toLocaleString()}km
              </span>
            ))}
          </p>
        )}
        {trips.length ? (
          <ul className="mt-2 divide-y divide-slate-100">
            {[...trips].reverse().map((t, i) => (
              <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span className="tabular-nums text-slate-600">
                  {md(t.date)} {t.start ? hm(t.start) : "--:--"}〜{t.end ? hm(t.end) : "--:--"}
                </span>
                <span className="font-medium">{t.vehicle}</span>
                <span>{t.driverName}</span>
                {t.destination && <span className="text-slate-600">{t.destination}</span>}
                <span className="ml-auto tabular-nums text-slate-700">{t.distance != null ? `${t.distance.toLocaleString()}km` : t.end ? "距離なし" : "運転中・帰着の記録なし"}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-slate-500">今月の運転はまだありません。</p>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">今月の記録({checks.length}件)</h2>
          <a href={`/api/alcohol-checks?month=${today.slice(0, 7)}&format=csv`} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs hover:bg-slate-50">
            記録簿をCSVで出す
          </a>
        </div>
        {checks.length ? (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left">
              <thead className="text-xs text-slate-500">
                <tr>
                  <th className="py-1.5 pr-3 font-normal">日時</th>
                  <th className="py-1.5 pr-3 font-normal">前・後</th>
                  <th className="py-1.5 pr-3 font-normal">運転者</th>
                  <th className="py-1.5 pr-3 font-normal">車</th>
                  <th className="py-1.5 pr-3 font-normal">方法</th>
                  <th className="py-1.5 pr-3 font-normal">結果</th>
                  <th className="py-1.5 font-normal">確認者</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {checks.map((c) => (
                  <tr key={c.id} className={c.detected ? "bg-rose-50" : ""}>
                    <td className="py-1.5 pr-3 tabular-nums">
                      {md(c.date)} {hm(c.checkedAt)}
                    </td>
                    <td className="py-1.5 pr-3">{TIMINGS[c.timing as "BEFORE"] ?? c.timing}</td>
                    <td className="py-1.5 pr-3">{c.driverName}</td>
                    <td className="py-1.5 pr-3">{c.vehicle}</td>
                    <td className="py-1.5 pr-3">{METHODS[c.method as "FACE"] ?? c.method}</td>
                    <td className={`py-1.5 pr-3 ${c.detected ? "font-medium text-rose-700" : ""}`}>
                      {c.detected ? "酒気あり" : "なし"}
                      {c.value ? `(${c.value})` : ""}
                    </td>
                    <td className="py-1.5">{c.checkerName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-2 text-slate-500">今月の記録はまだありません。</p>
        )}
      </section>
    </div>
  );
}

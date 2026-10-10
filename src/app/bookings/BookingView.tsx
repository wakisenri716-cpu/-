"use client";

import { useState } from "react";
import { FACILITY_KINDS, type FacilityKind } from "@/lib/bookingText";

type Facility = { id: string; name: string; kind: string; note: string | null };
type Booking = { id: string; facilityId: string; date: string; start: string; end: string; title: string; userId: string | null; userName: string; facility: { name: string; kind: string } };
type Draft = { facilityId: string | null; date: string; start: string | null; end: string | null; title: string };

const input = "w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm";
const WEEK = "日月火水木金土";
const dayLabel = (k: string) => `${Number(k.slice(5, 7))}/${Number(k.slice(8, 10))}(${WEEK[new Date(`${k}T00:00:00Z`).getUTCDay()]})`;
const addDays = (k: string, n: number) => new Date(Date.parse(`${k}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const HOURS = Array.from({ length: 13 }, (_, i) => 8 + i); // 8時〜20時
const pos = (hm: string) => Math.min(100, Math.max(0, ((Number(hm.slice(0, 2)) + Number(hm.slice(3, 5)) / 60 - 8) / 12) * 100));

export default function BookingView({ facilities: initialFacilities, initial, today, viewerId, canManage }: { facilities: Facility[]; initial: Booking[]; today: string; viewerId: string; canManage: boolean }) {
  const [facilities, setFacilities] = useState(initialFacilities);
  const [bookings, setBookings] = useState(initial);
  const [day, setDay] = useState(today);
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState<FacilityKind>("ROOM");

  async function call(url: string, method: string, body?: unknown) {
    const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "うまくいきませんでした");
    return data;
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
  const reload = async (from = today) => setBookings((await call(`/api/bookings?from=${from}&days=31`, "GET")).bookings);

  const parse = () =>
    run("parse", async () => {
      const data = await call("/api/bookings/parse", "POST", { text });
      setDraft({ ...data.draft, facilityId: data.draft.facilityId ?? facilities[0]?.id ?? null, start: data.draft.start ?? "10:00", end: data.draft.end ?? "11:00" });
      setWarnings(data.warnings);
    });
  const save = () =>
    run("save", async () => {
      const data = await call("/api/bookings", "POST", draft);
      setFlash(`${data.booking.facility.name}を ${dayLabel(data.booking.date)} ${data.booking.start}〜${data.booking.end} で予約しました${data.warnings.length ? `(注意: ${data.warnings.join("・")})` : ""}`);
      setDraft(null);
      setText("");
      setDay(data.booking.date);
      await reload(data.booking.date < today ? data.booking.date : today);
    });
  const cancel = (id: string) =>
    run(id, async () => {
      await call(`/api/bookings/${id}`, "DELETE");
      setBookings((b) => b.filter((x) => x.id !== id));
    });
  const addFacility = () =>
    run("facility", async () => {
      const data = await call("/api/facilities", "POST", { name: newName, kind: newKind });
      setFacilities(data.facilities);
      setNewName("");
    });
  const removeFacility = (id: string) =>
    run(`f-${id}`, async () => {
      const data = await call("/api/facilities", "DELETE", { id });
      setFacilities(data.facilities);
    });

  const ofDay = bookings.filter((b) => b.date === day);
  return (
    <div className="space-y-6">
      {facilities.length > 0 ? (
        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm sm:p-6">
          <div className="flex flex-col gap-2 sm:flex-row">
            <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && text.trim() && parse()} placeholder="例: 明日14時から15時 会議室A 来客打ち合わせ" className={input} />
            <button onClick={parse} disabled={!!busy || !text.trim()} className="shrink-0 rounded-md bg-vermilion-600 px-4 py-2 font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
              {busy === "parse" ? "読み取っています…" : "読み取る"}
            </button>
          </div>
          {draft && (
            <div className="space-y-2 rounded-md border border-slate-200 p-3">
              <div className="grid gap-2 sm:grid-cols-[1fr_9rem_6rem_6rem_1.5fr_auto] sm:items-center">
                <select aria-label="予約するもの" value={draft.facilityId ?? ""} onChange={(e) => setDraft({ ...draft, facilityId: e.target.value })} className={input}>
                  {facilities.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
                <input aria-label="日付" type="date" value={draft.date} onChange={(e) => e.target.value && setDraft({ ...draft, date: e.target.value })} className={input} />
                <input aria-label="始まり" type="time" value={draft.start ?? ""} onChange={(e) => setDraft({ ...draft, start: e.target.value })} className={input} />
                <input aria-label="終わり" type="time" value={draft.end ?? ""} onChange={(e) => setDraft({ ...draft, end: e.target.value })} className={input} />
                <input aria-label="用件" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className={input} />
                <button onClick={save} disabled={!!busy} className="rounded-md bg-vermilion-600 px-4 py-2 font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
                  {busy === "save" ? "予約しています…" : "予約する"}
                </button>
              </div>
              {warnings.length > 0 && <p className="rounded-md bg-amber-50 px-3 py-1.5 text-xs text-amber-900">⚠ {warnings.join("・")}</p>}
            </div>
          )}
          {error && <p className="rounded-md bg-rose-50 px-3 py-2 text-rose-800">{error}</p>}
          {flash && <p className="rounded-md bg-emerald-50 px-3 py-2 text-emerald-800">{flash}</p>}
        </section>
      ) : (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-600">まず下の「予約できるもの」に会議室や社用車を登録してください。</p>
      )}

      {facilities.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => setDay(addDays(day, -1))} className="rounded-md border border-slate-300 px-2 py-1 hover:bg-slate-50" aria-label="前の日">
              ←
            </button>
            <h2 className="font-semibold">{dayLabel(day)}の予約</h2>
            <button onClick={() => setDay(addDays(day, 1))} className="rounded-md border border-slate-300 px-2 py-1 hover:bg-slate-50" aria-label="次の日">
              →
            </button>
            {day !== today && (
              <button onClick={() => setDay(today)} className="text-xs text-indigo-700 hover:underline">
                今日
              </button>
            )}
          </div>
          <div className="mt-3 overflow-x-auto">
            <div className="min-w-[36rem] space-y-2">
              <div className="relative ml-28 h-4 text-[10px] text-slate-400">
                {HOURS.slice(0, -1).map((h) => (
                  <span key={h} className="absolute -translate-x-1/2" style={{ left: `${((h - 8) / 12) * 100}%` }}>
                    {h}
                  </span>
                ))}
              </div>
              {facilities.map((f) => (
                <div key={f.id} className="flex items-center gap-2">
                  <span className="w-26 shrink-0 truncate text-xs font-medium" title={f.name}>
                    {f.name}
                  </span>
                  <div className="relative h-9 flex-1 rounded bg-slate-50 ring-1 ring-slate-200">
                    {ofDay
                      .filter((b) => b.facilityId === f.id)
                      .map((b) => (
                        <div key={b.id} title={`${b.start}〜${b.end} ${b.title}(${b.userName})`} className="absolute inset-y-1 overflow-hidden rounded bg-indigo-100 px-1 text-[10px] leading-tight text-indigo-900 ring-1 ring-indigo-300" style={{ left: `${pos(b.start)}%`, width: `${Math.max(2, pos(b.end) - pos(b.start))}%` }}>
                          {b.start} {b.title}
                        </div>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
          {ofDay.length ? (
            <ul className="mt-3 divide-y divide-slate-100">
              {ofDay.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  <span className="tabular-nums">
                    {b.start}〜{b.end}
                  </span>
                  <span className="font-medium">{b.facility.name}</span>
                  <span>{b.title}</span>
                  <span className="text-xs text-slate-500">{b.userName}</span>
                  {(b.userId === viewerId || canManage) && (
                    <button onClick={() => cancel(b.id)} disabled={busy === b.id} className="ml-auto text-xs text-slate-500 hover:text-rose-700">
                      取り消す
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-slate-500">この日の予約はありません。</p>
          )}
        </section>
      )}

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
        <h2 className="font-semibold">予約できるもの</h2>
        {facilities.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {facilities.map((f) => (
              <li key={f.id} className="flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1">
                <span className="text-xs text-slate-500">{FACILITY_KINDS[f.kind as FacilityKind] ?? "そのほか"}</span>
                <span>{f.name}</span>
                {canManage && (
                  <button onClick={() => removeFacility(f.id)} disabled={!!busy} className="text-xs text-slate-400 hover:text-rose-700" aria-label={`${f.name}を外す`}>
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {canManage && (
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="種類" value={newKind} onChange={(e) => setNewKind(e.target.value as FacilityKind)} className="rounded-md border border-slate-300 px-2 py-1.5">
              {(Object.keys(FACILITY_KINDS) as FacilityKind[]).map((k) => (
                <option key={k} value={k}>
                  {FACILITY_KINDS[k]}
                </option>
              ))}
            </select>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="例: 会議室A / 社用車プリウス" className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1.5" />
            <button onClick={addFacility} disabled={!!busy || !newName.trim()} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50 disabled:opacity-50">
              足す
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

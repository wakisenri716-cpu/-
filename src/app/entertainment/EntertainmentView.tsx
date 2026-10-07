"use client";

import { useState } from "react";
import type { EntertainmentKind, EntertainmentRow } from "@/lib/entertainment";
import { formatYen } from "@/lib/format";

type Data = { fy: { from: string; to: string }; small: boolean; used: number; excludable: number; counted: number; forecast: number; limit: number | null; elapsed: number; rows: EntertainmentRow[]; findings: string[] };
type Advice = { summary: string; tips: string[]; mode: "claude" | "template" };

const KINDS: [EntertainmentKind, string][] = [
  ["MEAL", "飲食"],
  ["GIFT", "贈答"],
  ["OTHER", "その他"],
];
const md = (key: string) => `${Number(key.slice(5, 7))}/${Number(key.slice(8, 10))}`;

export default function EntertainmentView({ initial, ai }: { initial: Data; ai: boolean }) {
  const [data, setData] = useState<Data>(initial);
  const [advice, setAdvice] = useState<Advice | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [onlyMissing, setOnlyMissing] = useState(false);
  const pct = data.limit ? Math.min(100, Math.round((data.counted / data.limit) * 100)) : 0;
  const pacePct = data.limit ? Math.min(100, Math.round((data.forecast / data.limit) * 100)) : 0;

  async function ask() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/entertainment/advice", { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "うまくいきませんでした");
      setAdvice(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "うまくいきませんでした");
    } finally {
      setBusy(false);
    }
  }

  const rows = data.rows.filter((r) => !onlyMissing || r.missing.length > 0).slice().reverse();
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-500">今期に使った交際費</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{formatYen(data.used)}</p>
          <p className="mt-1 text-xs text-slate-500">{data.rows.length}件</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-500">1人1万円以下の飲食費(除ける額)</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{formatYen(data.excludable)}</p>
          <p className="mt-1 text-xs text-slate-500">記録(人数・相手)がそろったものだけ</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-500">1年のペース(除いたあと)</p>
          <p className={`mt-1 text-2xl font-semibold tabular-nums ${data.limit && data.forecast > data.limit ? "text-rose-700" : ""}`}>{formatYen(data.forecast)}</p>
          <p className="mt-1 text-xs text-slate-500">{data.limit ? `上限 ${formatYen(data.limit)}` : "800万円の枠は使えない会社です"}</p>
        </div>
      </div>
      {data.limit && (
        <div className="space-y-1">
          <div className="relative h-3 overflow-hidden rounded-full bg-slate-200" role="img" aria-label={`上限に対して、いま${pct}%・ペース${pacePct}%`}>
            <div className="absolute inset-y-0 left-0 bg-slate-400" style={{ width: `${pacePct}%` }} />
            <div className={`absolute inset-y-0 left-0 ${data.forecast > data.limit ? "bg-rose-600" : "bg-indigo-700"}`} style={{ width: `${pct}%` }} />
          </div>
          <p className="text-xs text-slate-500">
            濃い色: いままでの分({pct}%) ・ 薄い色: このペースでの1年分({pacePct}%) ・ 期首から{data.elapsed}か月
          </p>
        </div>
      )}

      <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
        {data.findings.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>

      {data.rows.length > 0 && (
        <button
          onClick={ask}
          disabled={busy}
          className={ai ? "rounded-md border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50" : "rounded-md bg-vermilion-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-vermilion-700 disabled:opacity-50"}
        >
          {busy ? "見ています…" : ai ? "AIに見立てを聞く" : "次にやることを見る"}
        </button>
      )}
      {error && <p className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-800">{error}</p>}
      {advice && (
        <section className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-950">
          <p>{advice.summary}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {advice.tips.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </section>
      )}

      {data.rows.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
            <h2 className="text-sm font-semibold">明細と記録(新しい順)</h2>
            <label className="inline-flex items-center gap-1.5 text-sm text-slate-700">
              <input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} className="accent-indigo-700" />
              記録が足りないものだけ
            </label>
          </div>
          <ul className="divide-y">
            {rows.map((r) => (
              <RowEditor key={r.lineId} row={r} onSaved={setData} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function RowEditor({ row, onSaved }: { row: EntertainmentRow; onSaved: (d: Data) => void }) {
  const [kind, setKind] = useState<EntertainmentKind>(row.kind);
  const [persons, setPersons] = useState(row.persons ? String(row.persons) : "");
  const [guests, setGuests] = useState(row.guests ?? "");
  const [purpose, setPurpose] = useState(row.purpose ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = kind !== row.kind || persons !== (row.persons ? String(row.persons) : "") || guests !== (row.guests ?? "") || purpose !== (row.purpose ?? "") || !row.recorded;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/entertainment", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lineId: row.lineId, kind, persons, guests, purpose }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "うまくいきませんでした");
      onSaved(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "うまくいきませんでした");
    } finally {
      setBusy(false);
    }
  }

  const input = "rounded-md border border-slate-300 px-2 py-1 text-sm";
  return (
    <li className="space-y-2 px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="w-12 text-sm text-slate-500 tabular-nums">{md(row.date)}</span>
        <span className="min-w-0 flex-1 text-sm">{row.description}</span>
        <span className="text-sm font-medium tabular-nums">{formatYen(row.amount)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 pl-0 sm:pl-15">
        <select value={kind} onChange={(e) => setKind(e.target.value as EntertainmentKind)} aria-label="種類" className={input}>
          {KINDS.map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        <input value={persons} onChange={(e) => setPersons(e.target.value.replace(/[^\d]/g, ""))} inputMode="numeric" placeholder="人数" aria-label="人数" className={`${input} w-16 text-right`} />
        <input value={guests} onChange={(e) => setGuests(e.target.value)} placeholder="相手(会社名・氏名・関係)" aria-label="相手" maxLength={200} className={`${input} w-full sm:w-auto sm:min-w-0 sm:flex-1 sm:max-w-xs`} />
        <input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="目的(任意)" aria-label="目的" maxLength={200} className={`${input} w-full sm:w-auto sm:min-w-0 sm:flex-1 sm:max-w-[12rem]`} />
        <button onClick={save} disabled={busy || !dirty} className="rounded-md border border-slate-300 bg-white px-3 py-1 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40">
          {busy ? "保存中…" : row.recorded && !dirty ? "記録済み" : "記録する"}
        </button>
      </div>
      <div className="flex flex-wrap gap-2 pl-0 text-xs sm:pl-15">
        {row.perPerson !== null && <span className="text-slate-600">1人あたり {formatYen(row.perPerson)}</span>}
        {row.underLimit && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-800">1万円以下(交際費から除ける)</span>}
        {row.missing.length > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">記録が足りない: {row.missing.join("・")}</span>}
        {!row.recorded && row.persons !== null && <span className="text-slate-500">人数は摘要から読み取りました</span>}
      </div>
      {error && <p className="text-sm text-rose-700">{error}</p>}
    </li>
  );
}

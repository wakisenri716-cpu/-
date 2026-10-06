"use client";

import Link from "next/link";
import { useState } from "react";
import type { CalendarCategory, CalendarEvent, CalendarPlan } from "@/lib/taxCalendar";

type Data = { today: string; events: CalendarEvent[]; findings: string[] };

const CATEGORY: Record<CalendarCategory, string> = { tax: "税金", social: "社会保険", labor: "労務" };
const STATUS: Record<CalendarEvent["status"], { label: string; cls: string } | null> = {
  done: { label: "済み", cls: "bg-emerald-100 text-emerald-800" },
  overdue: { label: "期限切れ", cls: "bg-rose-100 text-rose-800" },
  soon: { label: "2週間以内", cls: "bg-amber-100 text-amber-800" },
  later: null,
};
const WEEK = ["日", "月", "火", "水", "木", "金", "土"];
const md = (key: string) => `${Number(key.slice(5, 7))}/${Number(key.slice(8, 10))}`;
const wd = (key: string) => WEEK[new Date(`${key}T00:00:00Z`).getUTCDay()];

export default function TaxCalendarView({ initial, ai }: { initial: Data; ai: boolean }) {
  const [data, setData] = useState<Data>(initial);
  const [filter, setFilter] = useState<CalendarCategory | "all">("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<CalendarPlan | null>(null);

  async function toggle(key: string, done: boolean) {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch("/api/tax-calendar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key, done }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "うまくいきませんでした");
      setData(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "うまくいきませんでした");
    } finally {
      setBusy(null);
    }
  }

  async function makePlan() {
    setBusy("plan");
    setError(null);
    try {
      const res = await fetch("/api/tax-calendar/plan", { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "うまくいきませんでした");
      setPlan(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "うまくいきませんでした");
    } finally {
      setBusy(null);
    }
  }

  const shown = data.events.filter((e) => filter === "all" || e.category === filter);
  const months = [...new Set(shown.map((e) => e.due.slice(0, 7)))];

  return (
    <div className="space-y-6">
      <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
        {data.findings.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={makePlan}
          disabled={busy === "plan"}
          className={ai ? "rounded-md border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50" : "rounded-md bg-vermilion-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-vermilion-700 disabled:opacity-50"}
        >
          {busy === "plan" ? (ai ? "AIが考えています…" : "作っています…") : ai ? "AIに近い期限の段取りを聞く" : "近い期限の段取りを作る"}
        </button>
        <a href="/api/tax-calendar/ics" className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
          スマホのカレンダーに入れる(.ics)
        </a>
      </div>
      {error && <p className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-800">{error}</p>}

      {plan && (
        <section className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-950">
          <h2 className="font-semibold">近い期限の段取り{plan.mode === "claude" ? "(AI)" : ""}</h2>
          <p className="mt-1">{plan.summary}</p>
          {plan.steps.length > 0 && (
            <ol className="mt-2 space-y-1">
              {plan.steps.map((s, i) => (
                <li key={i} className="flex gap-3">
                  <span className="w-16 shrink-0 font-medium tabular-nums">
                    {md(s.date)}({wd(s.date)})
                  </span>
                  <span>{s.todo}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      <div className="flex flex-wrap gap-2" role="tablist">
        {(["all", "tax", "social", "labor"] as const).map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={filter === k}
            onClick={() => setFilter(k)}
            className={`rounded-full border px-3 py-1 text-sm ${filter === k ? "border-indigo-700 bg-indigo-700 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
          >
            {k === "all" ? "すべて" : CATEGORY[k]}
          </button>
        ))}
      </div>

      {months.length === 0 && <p className="text-sm text-slate-600">表示する期限はありません。</p>}
      {months.map((m) => (
        <section key={m} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <h2 className="border-b bg-slate-50 px-4 py-2 text-sm font-semibold">
            {m.slice(0, 4)}年{Number(m.slice(5))}月
          </h2>
          <ul className="divide-y">
            {shown
              .filter((e) => e.due.startsWith(m))
              .map((e) => {
                const chip = STATUS[e.status];
                return (
                  <li key={e.key} className="flex gap-3 px-4 py-3">
                    <div className={`w-14 shrink-0 text-center ${e.due === data.today ? "text-vermilion-700" : ""}`}>
                      <div className="text-lg leading-tight font-semibold tabular-nums">{Number(e.due.slice(8, 10))}</div>
                      <div className="text-xs text-slate-500">{wd(e.due)}曜</div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className={`text-sm font-medium ${e.done ? "text-slate-500 line-through decoration-slate-400" : ""}`}>{e.title}</span>
                        <span className="rounded-full border border-slate-300 px-2 py-0.5 text-xs text-slate-600">{CATEGORY[e.category]}</span>
                        {chip && <span className={`rounded-full px-2 py-0.5 text-xs ${chip.cls}`}>{chip.label}</span>}
                      </div>
                      <p className="mt-0.5 text-sm text-slate-700">{e.detail}</p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {e.start && `受付 ${md(e.start)}〜 ・ `}期限 {md(e.due)}
                        {e.note && ` ・ ${e.note}`}
                        {e.doneBy && ` ・ ${e.doneBy}さんが済みに`}
                        {e.auto && e.done && !e.doneBy && " ・ 納付済みの記録あり"}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                        <label className="inline-flex items-center gap-1.5 text-slate-700">
                          <input type="checkbox" checked={e.done} disabled={busy === e.key} onChange={(ev) => toggle(e.key, ev.target.checked)} className="h-4 w-4 accent-indigo-700" />
                          済み
                        </label>
                        {e.link && (
                          <Link href={e.link} className="text-indigo-700 hover:underline">
                            開く →
                          </Link>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
          </ul>
        </section>
      ))}
    </div>
  );
}

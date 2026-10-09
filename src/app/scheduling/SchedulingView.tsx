"use client";

import { useMemo, useState } from "react";
import { jstDateKey } from "@/lib/jst";
import {
  PLACE_LABEL,
  schedulingMail,
  slotLabel,
  slotWarnings,
  type Place,
  type Slot,
} from "@/lib/schedulingText";

type Party = {
  kind: "customer" | "vendor";
  id: string;
  name: string;
  email: string | null;
};
type Draft = {
  to: string;
  me: { company: string; name: string };
  purpose: string;
  subject: string;
  slots: Slot[];
  busy: string[];
  closures?: Record<string, string>;
  place: Place;
  minutes: number;
  intro: string | null;
  closing: string | null;
  mode: "claude" | "template";
};

const input =
  "mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm";

export default function SchedulingView({
  parties,
  initialParty,
  ai,
}: {
  parties: Party[];
  initialParty: string;
  ai: boolean;
}) {
  const [party, setParty] = useState(initialParty);
  const [purpose, setPurpose] = useState("");
  const [minutes, setMinutes] = useState(60);
  const [time, setTime] = useState<"any" | "am" | "pm">("any");
  const [count, setCount] = useState(3);
  const [after, setAfter] = useState(2);
  const [place, setPlace] = useState<Place>("online");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [subject, setSubject] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function make(useAi: boolean, slots?: Slot[]) {
    setBusy(useAi ? "ai" : "make");
    setError(null);
    setCopied(false);
    try {
      const [partyKind, partyId] = party ? party.split(":") : [null, null];
      const res = await fetch("/api/scheduling", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          partyKind,
          partyId,
          purpose,
          minutes,
          time,
          count,
          after,
          place,
          useAi,
          slots,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "うまくいきませんでした");
      setDraft(data);
      setSubject(data.subject);
    } catch (e) {
      setError(e instanceof Error ? e.message : "うまくいきませんでした");
    } finally {
      setBusy(null);
    }
  }

  const today = jstDateKey(new Date());
  const body = useMemo(() => (draft ? schedulingMail(draft) : ""), [draft]);
  const warnings = draft ? slotWarnings(draft.slots, today, draft.closures ?? {}) : [];
  const email = party
    ? parties.find((p) => `${p.kind}:${p.id}` === party)?.email
    : null;
  const setSlot = (i: number, patch: Partial<Slot>) =>
    setDraft((d) =>
      d
        ? {
            ...d,
            slots: d.slots.map((s, j) => (j === i ? { ...s, ...patch } : s)),
          }
        : d,
    );

  async function copy() {
    try {
      await navigator.clipboard.writeText(`件名: ${subject}\n\n${body}`);
      setCopied(true);
    } catch {
      setError("コピーできませんでした。本文を選んでコピーしてください");
    }
  }

  return (
    <div className="space-y-6">
      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="text-slate-700">相手(住所録から・任意)</span>
            <select
              value={party}
              onChange={(e) => setParty(e.target.value)}
              className={input}
            >
              <option value="">選ばない(ご担当者様)</option>
              {parties.map((p) => (
                <option key={`${p.kind}:${p.id}`} value={`${p.kind}:${p.id}`}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-slate-700">用件(任意)</span>
            <input
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="例: 来期のお取引条件のご相談"
              className={input}
            />
          </label>
          <label className="block text-sm">
            <span className="text-slate-700">所要時間</span>
            <select
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value))}
              className={input}
            >
              {[30, 45, 60, 90, 120].map((m) => (
                <option key={m} value={m}>
                  {m}分
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-slate-700">場所</span>
            <select
              value={place}
              onChange={(e) => setPlace(e.target.value as Place)}
              className={input}
            >
              {(Object.keys(PLACE_LABEL) as Place[]).map((p) => (
                <option key={p} value={p}>
                  {PLACE_LABEL[p]}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-slate-700">時間帯</span>
            <select
              value={time}
              onChange={(e) => setTime(e.target.value as "any" | "am" | "pm")}
              className={input}
            >
              <option value="any">午前・午後どちらも</option>
              <option value="am">午前</option>
              <option value="pm">午後</option>
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-slate-700">候補の数</span>
              <select
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
                className={input}
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n}つ
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-slate-700">何日後から</span>
              <select
                value={after}
                onChange={(e) => setAfter(Number(e.target.value))}
                className={input}
              >
                {[1, 2, 3, 5, 7, 14].map((n) => (
                  <option key={n} value={n}>
                    {n}日後
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => make(false)}
            disabled={!!busy}
            className="rounded-md bg-vermilion-600 px-4 py-2 text-sm font-medium text-white hover:bg-vermilion-700 disabled:opacity-50"
          >
            {busy === "make" ? "作っています…" : "候補とメールを作る"}
          </button>
          {ai && (
            <button
              onClick={() => make(true, draft?.slots)}
              disabled={!!busy}
              className="rounded-md border border-indigo-300 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
            >
              {busy === "ai" ? "AIが整えています…" : "AIで整える"}
            </button>
          )}
        </div>
        {error && (
          <p className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-800">
            {error}
          </p>
        )}
      </section>

      {draft && (
        <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
          <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
            <h2 className="font-semibold">候補の日時</h2>
            {draft.busy.length > 0 && (
              <p className="text-xs text-slate-500">
                打ち合わせ・訪問のやることがある日(
                {draft.busy
                  .map(
                    (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`,
                  )
                  .join("・")}
                )は外しました。
              </p>
            )}
            <ul className="space-y-2">
              {draft.slots.map((s, i) => (
                <li
                  key={i}
                  className="space-y-1 rounded-md border border-slate-200 p-2"
                >
                  <p className="text-xs text-slate-600">{slotLabel(s)}</p>
                  <div className="flex flex-wrap items-center gap-1">
                    <input
                      aria-label="日付"
                      type="date"
                      value={s.date}
                      onChange={(e) =>
                        e.target.value && setSlot(i, { date: e.target.value })
                      }
                      className="rounded border border-slate-300 px-1.5 py-1 text-xs"
                    />
                    <input
                      aria-label="始まり"
                      type="time"
                      value={s.start}
                      onChange={(e) =>
                        e.target.value && setSlot(i, { start: e.target.value })
                      }
                      className="rounded border border-slate-300 px-1.5 py-1 text-xs"
                    />
                    〜
                    <input
                      aria-label="終わり"
                      type="time"
                      value={s.end}
                      onChange={(e) =>
                        e.target.value && setSlot(i, { end: e.target.value })
                      }
                      className="rounded border border-slate-300 px-1.5 py-1 text-xs"
                    />
                    <button
                      onClick={() =>
                        setDraft((d) =>
                          d && d.slots.length > 1
                            ? { ...d, slots: d.slots.filter((_, j) => j !== i) }
                            : d,
                        )
                      }
                      className="ml-auto text-xs text-slate-500 hover:text-rose-700"
                    >
                      外す
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            {warnings.length > 0 && (
              <ul className="space-y-1 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
                {warnings.map((w) => (
                  <li key={w}>⚠ {w}</li>
                ))}
              </ul>
            )}
          </section>
          <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">メールの下書き</h2>
              <span className="text-xs text-slate-500">
                {draft.mode === "claude"
                  ? "AIが前置きと結びを整えました"
                  : "ひな形の下書きです"}
              </span>
            </div>
            <label className="block">
              <span className="text-slate-700">件名</span>
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className={input}
              />
            </label>
            <pre className="whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-3 font-sans text-sm leading-relaxed">
              {body}
            </pre>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={copy}
                className="rounded-md bg-vermilion-600 px-4 py-2 font-medium text-white hover:bg-vermilion-700"
              >
                件名と本文をコピー
              </button>
              {email && (
                <a
                  href={`mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`}
                  className="rounded-md border border-slate-300 bg-white px-4 py-2 hover:bg-slate-50"
                >
                  メールソフトで開く
                </a>
              )}
              {copied && (
                <span className="text-emerald-700">コピーしました</span>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

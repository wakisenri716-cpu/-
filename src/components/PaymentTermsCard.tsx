"use client";

import { useState } from "react";
import {
  DEFAULT_TERMS,
  dueDateFor,
  termsLabel,
  type PaymentTerms,
} from "@/lib/paymentTerms";
import { jstDateKey } from "@/lib/jst";

const select =
  "mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm";

// 顧客の支払条件(締め日・支払日・休日の扱い)。請求書の支払期限の初期値になる
export function PaymentTermsCard({
  id,
  initial,
}: {
  id: string;
  initial: PaymentTerms | null;
}) {
  const [saved, setSaved] = useState(initial);
  const [t, setT] = useState<PaymentTerms>(initial ?? DEFAULT_TERMS);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const today = jstDateKey(new Date());

  async function save(clear = false) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/customers/${id}/terms`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(clear ? { clear: true } : t),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "保存できませんでした");
      setSaved(data.terms);
      if (!data.terms) setT(DEFAULT_TERMS);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存できませんでした");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">支払条件</h2>
        {!editing && (
          <button
            onClick={() => setEditing(true)}
            className="text-xs text-indigo-700 underline"
          >
            {saved ? "変える" : "決める"}
          </button>
        )}
      </div>
      {!editing ? (
        <p className="text-slate-700">
          {saved
            ? termsLabel(saved)
            : "まだ決めていません(請求書の支払期限は「翌月末」になります)"}
          {saved && (
            <span className="ml-2 text-xs text-slate-500">
              今日の請求なら期限は {dueDateFor(saved, today)}
            </span>
          )}
        </p>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-4">
            <label className="block">
              <span className="text-slate-600">締め日</span>
              <select
                aria-label="締め日"
                value={t.closingDay}
                onChange={(e) =>
                  setT({ ...t, closingDay: Number(e.target.value) })
                }
                className={select}
              >
                <option value={0}>月末</option>
                {[5, 10, 15, 20, 25].map((d) => (
                  <option key={d} value={d}>
                    {d}日
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-slate-600">支払月</span>
              <select
                aria-label="支払月"
                value={t.payMonths}
                onChange={(e) =>
                  setT({ ...t, payMonths: Number(e.target.value) })
                }
                className={select}
              >
                <option value={0}>当月</option>
                <option value={1}>翌月</option>
                <option value={2}>翌々月</option>
                <option value={3}>3か月後</option>
              </select>
            </label>
            <label className="block">
              <span className="text-slate-600">支払日</span>
              <select
                aria-label="支払日"
                value={t.payDay}
                onChange={(e) => setT({ ...t, payDay: Number(e.target.value) })}
                className={select}
              >
                <option value={0}>末日</option>
                {[5, 10, 15, 20, 25].map((d) => (
                  <option key={d} value={d}>
                    {d}日
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-slate-600">支払日が休みの日なら</span>
              <select
                aria-label="休日の扱い"
                value={t.holidayRule}
                onChange={(e) =>
                  setT({
                    ...t,
                    holidayRule: e.target.value as PaymentTerms["holidayRule"],
                  })
                }
                className={select}
              >
                <option value="none">そのまま</option>
                <option value="next">翌営業日</option>
                <option value="prev">前営業日</option>
              </select>
            </label>
          </div>
          <p className="text-xs text-slate-600">
            {termsLabel(t)}。今日({today})の請求なら、支払期限は{" "}
            <span className="font-medium">{dueDateFor(t, today)}</span> です。
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => save()}
              disabled={busy}
              className="rounded-md bg-vermilion-600 px-4 py-1.5 font-medium text-white hover:bg-vermilion-700 disabled:opacity-50"
            >
              保存
            </button>
            {saved && (
              <button
                onClick={() => save(true)}
                disabled={busy}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-slate-600 hover:bg-slate-50"
              >
                決めない(消す)
              </button>
            )}
            <button
              onClick={() => setEditing(false)}
              className="rounded-md px-3 py-1.5 text-slate-500"
            >
              やめる
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className="rounded-md bg-rose-50 px-3 py-2 text-rose-800">{error}</p>
      )}
    </section>
  );
}

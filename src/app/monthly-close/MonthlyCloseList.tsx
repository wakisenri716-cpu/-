"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CheckItem } from "@/lib/monthlyClose";

type Data = { month: string; prev: string; next: string | null; items: CheckItem[]; done: number; total: number };

function Mark({ done }: { done: boolean }) {
  return (
    <span
      aria-hidden
      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs font-bold ${done ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-300 bg-white text-transparent"}`}
    >
      ✓
    </span>
  );
}

export function MonthlyCloseList({ initial, monthLabel, customItems }: { initial: Data; monthLabel: string; customItems: string[] }) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [itemsText, setItemsText] = useState(customItems.join("\n"));

  // 月を切り替えたときは、サーバーで作り直した最新のデータに合わせる
  if (initial.month !== data.month) setData(initial);

  async function toggle(item: CheckItem) {
    setBusy(item.key);
    setError(null);
    const res = await fetch("/api/monthly-close", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ month: data.month, key: item.key, done: !item.done }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return setError(json.error || "保存できませんでした");
    setData(json);
    router.refresh();
  }

  async function saveItems() {
    setBusy("items");
    setError(null);
    const res = await fetch("/api/monthly-close/items", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: itemsText.split("\n") }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return setError(json.error || "保存できませんでした");
    setEditing(false);
    const fresh = await fetch(`/api/monthly-close?month=${data.month}`);
    if (fresh.ok) setData(await fresh.json());
    router.refresh();
  }

  const auto = data.items.filter((i) => i.kind === "auto");
  const manual = data.items.filter((i) => i.kind === "manual");
  const percent = Math.round((data.done / data.total) * 100);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <Link href={`/monthly-close?month=${data.prev}`} className="rounded-md border px-2 py-1 text-sm text-slate-600 hover:bg-slate-50" aria-label="前の月">
            ←
          </Link>
          <h2 className="text-lg font-semibold">{monthLabel}の締め</h2>
          {data.next ? (
            <Link href={`/monthly-close?month=${data.next}`} className="rounded-md border px-2 py-1 text-sm text-slate-600 hover:bg-slate-50" aria-label="次の月">
              →
            </Link>
          ) : (
            <span className="rounded-md border px-2 py-1 text-sm text-slate-300">→</span>
          )}
        </div>
        <div className="flex min-w-48 flex-1 items-center gap-3 sm:max-w-xs">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="進み具合">
            <div className={`h-full rounded-full ${data.done === data.total ? "bg-emerald-500" : "bg-indigo-500"}`} style={{ width: `${percent}%` }} />
          </div>
          <span className="text-sm font-medium tabular-nums">
            {data.done} / {data.total}
          </span>
        </div>
      </div>

      {error && <div className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</div>}

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <h3 className="border-b px-4 py-3 font-semibold">データから自動で確かめる項目</h3>
        <ul className="divide-y">
          {auto.map((item) => (
            <li key={item.key} className="flex items-start gap-3 px-4 py-3 text-sm">
              <Mark done={item.done} />
              <div className="min-w-0 flex-1">
                <p className={item.done ? "text-slate-500" : "font-medium"}>{item.label}</p>
                {item.detail && <p className={`mt-0.5 text-xs ${item.done ? "text-slate-400" : "text-amber-700"}`}>{item.detail}</p>}
              </div>
              {!item.done && item.href && (
                <Link href={item.href} className="shrink-0 text-xs font-medium text-indigo-700 hover:underline">
                  開く →
                </Link>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="font-semibold">人が確かめる項目</h3>
          <button onClick={() => setEditing((v) => !v)} className="text-xs text-indigo-700 hover:underline">
            {editing ? "やめる" : "項目を足す・消す"}
          </button>
        </div>
        <ul className="divide-y">
          {manual.map((item) => (
            <li key={item.key}>
              <button
                onClick={() => toggle(item)}
                disabled={busy !== null}
                className="flex w-full items-start gap-3 px-4 py-3 text-left text-sm hover:bg-slate-50 disabled:opacity-60"
                aria-pressed={item.done}
              >
                <Mark done={item.done} />
                <span className="min-w-0 flex-1">
                  <span className={item.done ? "text-slate-500" : "font-medium"}>{item.label}</span>
                  {item.done && item.checkedAt && (
                    <span className="mt-0.5 block text-xs text-slate-400">
                      {item.checkedBy} ・ {new Date(item.checkedAt).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {editing && (
          <div className="space-y-2 border-t bg-slate-50 px-4 py-3">
            <label className="block text-xs text-slate-600">
              会社で足す項目(1行に1つ。例: 在庫を数えて、在庫の金額を記帳した)
              <textarea value={itemsText} onChange={(e) => setItemsText(e.target.value)} rows={4} className="mt-1 w-full rounded-md border bg-white px-3 py-2 text-sm text-slate-900" />
            </label>
            <button onClick={saveItems} disabled={busy !== null} className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
              保存
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

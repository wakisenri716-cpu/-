"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { SparkleIcon } from "@/components/icons";
import { formatYen } from "@/lib/format";

type Task = { key: string; label: string; count: number; amount: number; href: string };
type Missing = { code: string; account: string; href: string; typical: number; last: { date: string; description: string } | null };
type Review = { summary: string; points: { level: "warn" | "info" | "ok"; text: string; href: string }[]; ready: boolean; mode: string; createdAt: string | Date };

const MARK = { warn: "bg-rose-100 text-rose-700", info: "bg-sky-100 text-sky-700", ok: "bg-emerald-100 text-emerald-700" };
const ICON = { warn: "!", info: "i", ok: "✓" };

// AIの月次決算アシスト: まとめて実行・計上漏れかもしれないもの・AIの見立て
export function CloseAssistant({ month, monthLabel, tasks, missing, review: initial }: { month: string; monthLabel: string; tasks: Task[]; missing: Missing[]; review: Review | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [review, setReview] = useState(initial);

  async function post(payload: Record<string, unknown>) {
    const res = await fetch("/api/monthly-close/assist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ month, ...payload }) });
    return { ok: res.ok, json: await res.json().catch(() => ({})) };
  }

  async function run(task: Task) {
    if (!window.confirm(`${monthLabel}までの「${task.label}」${task.count}件をまとめて記帳します。よろしいですか?`)) return;
    setBusy(task.key);
    setMessage(null);
    const { ok, json } = await post({ action: "run", task: task.key });
    setBusy(null);
    if (!ok) return setMessage({ ok: false, text: json.error || "実行できませんでした" });
    setMessage({ ok: json.errors.length === 0, text: `${task.label}: ${json.done}件 記帳しました${json.errors.length ? `。うまくいかなかったもの: ${json.errors.join(" / ")}` : ""}` });
    router.refresh();
  }

  async function ask() {
    setBusy("review");
    setMessage(null);
    const { ok, json } = await post({ action: "review" });
    setBusy(null);
    if (!ok) return setMessage({ ok: false, text: json.error || "見立てを作れませんでした" });
    setReview(json.review);
  }

  const open = tasks.filter((t) => t.count > 0);
  return (
    <section className="space-y-4 rounded-xl border border-indigo-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 font-semibold text-indigo-900">
          <SparkleIcon className="h-4 w-4" />
          AIの月次決算アシスト({monthLabel})
        </h2>
        <button onClick={ask} disabled={busy !== null} className="rounded-md bg-vermilion-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
          {busy === "review" ? "AIが確かめています…" : review ? "もう一度見立てる" : "締めてよいかAIに見立ててもらう"}
        </button>
      </div>
      {message && <p className={`rounded-md px-3 py-2 text-sm ${message.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"}`}>{message.text}</p>}

      {review && (
        <div className={`rounded-lg p-3 ${review.ready ? "bg-emerald-50" : "bg-amber-50"}`}>
          <p className="text-sm font-medium">
            <span className={`mr-2 rounded-full px-2 py-0.5 text-xs ${review.ready ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{review.ready ? "締めてよさそう" : "締める前にやることあり"}</span>
            {review.summary}
          </p>
          {review.points.length > 0 && (
            <ul className="mt-2 space-y-1.5">
              {review.points.map((p, i) => (
                <li key={i} className="flex gap-2 text-sm">
                  <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${MARK[p.level] ?? MARK.info}`}>{ICON[p.level] ?? "i"}</span>
                  <Link href={p.href} className="min-w-0 hover:underline">
                    {p.text}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-slate-500">{review.mode === "claude" ? "AIが見立てました" : "決まったルールで見立てました"}。締めるかどうかは試算表も見て決めてください。</p>
        </div>
      )}

      <div>
        <h3 className="text-sm font-semibold text-slate-700">まとめて片付けられること</h3>
        {open.length === 0 ? (
          <p className="mt-1 text-sm text-slate-500">まとめて記帳できる作業は残っていません。</p>
        ) : (
          <ul className="mt-1 divide-y">
            {open.map((t) => (
              <li key={t.key} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0 text-sm">
                  <Link href={t.href} className="font-medium hover:underline">
                    {t.label}
                  </Link>
                  <span className="ml-2 text-slate-500 tabular-nums">
                    {t.count}件{t.amount > 0 && `・${formatYen(t.amount)}`}
                  </span>
                </span>
                <button onClick={() => run(t)} disabled={busy !== null} className="rounded-md border border-indigo-600 px-3 py-1 text-sm text-indigo-700 hover:bg-indigo-50 disabled:opacity-50">
                  {busy === t.key ? "記帳しています…" : "まとめて実行"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className="text-sm font-semibold text-slate-700">計上漏れかもしれないもの</h3>
        {missing.length === 0 ? (
          <p className="mt-1 text-sm text-slate-500">前の3か月に毎月あった費用は、この月もすべて記帳されています。</p>
        ) : (
          <ul className="mt-1 space-y-1.5">
            {missing.map((m) => (
              <li key={m.code} className="text-sm">
                <Link href={m.href} className="font-medium hover:underline">
                  {m.account}
                </Link>
                <span className="ml-2 text-slate-600">いつもは月 {formatYen(m.typical)} ほど。この月はまだありません</span>
                {m.last && <span className="block text-xs text-slate-500">最後: {m.last.date} {m.last.description}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

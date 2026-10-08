"use client";

import { useState } from "react";
import Link from "next/link";
import type { TaskDraft } from "@/lib/teamTasks";
import {
  REPEAT_OPTIONS,
  ROUTINE_EXAMPLES,
  repeatLabel,
} from "@/lib/taskRepeat";
import { holidayName } from "@/lib/holidays";

type Task = {
  id: string;
  title: string;
  ownerUserId: string | null;
  ownerName: string | null;
  dueOn: string | null;
  partyKind: string | null;
  partyId: string | null;
  partyName: string | null;
  repeat: string | null;
  source: string;
  sourceId: string | null;
  status: "OPEN" | "DONE";
  doneAt: string | null;
  doneByName: string | null;
  createdByName: string;
  createdAt: string;
};
type User = { id: string; name: string; email: boolean };
type Party = { kind: string; id: string; name: string };

const SOURCE: Record<string, string> = {
  MINUTES: "議事録",
  VISIT: "訪問のあとで",
  ASSISTANT: "AIアシスタント",
};
const md = (key: string) =>
  `${Number(key.slice(5, 7))}/${Number(key.slice(8, 10))}`;
const days = (a: string, b: string) =>
  Math.round(
    (Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000,
  );

export default function TaskView({
  initial,
  users,
  parties,
  viewerId,
  today,
  ai,
}: {
  initial: Task[];
  users: User[];
  parties: Party[];
  viewerId: string;
  today: string;
  ai: boolean;
}) {
  const [tasks, setTasks] = useState(initial);
  const [text, setText] = useState("");
  const [drafts, setDrafts] = useState<TaskDraft[] | null>(null);
  const [mode, setMode] = useState<"claude" | "template" | null>(null);
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [filter, setFilter] = useState<"mine" | "open" | "done">("mine");

  async function call(url: string, init: RequestInit) {
    const res = await fetch(url, {
      headers: { "content-type": "application/json" },
      ...init,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "うまくいきませんでした");
    return data;
  }

  async function parse(useAi: boolean) {
    setBusy(useAi ? "ai" : "parse");
    setError(null);
    setFlash(null);
    try {
      const data = await call("/api/tasks/parse", {
        method: "POST",
        body: JSON.stringify({ text, useAi }),
      });
      setDrafts(data.tasks);
      setMode(data.mode);
      if (!data.tasks.length) setError("やることが見つかりませんでした");
    } catch (e) {
      setError(e instanceof Error ? e.message : "うまくいきませんでした");
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (!drafts?.length) return;
    setBusy("save");
    setError(null);
    try {
      const data = await call("/api/tasks", {
        method: "POST",
        body: JSON.stringify({ tasks: drafts, notify }),
      });
      const list = await call("/api/tasks", { method: "GET" });
      setTasks(list.tasks);
      setFlash(
        `${data.tasks.length}件のやることを登録しました${data.mailed ? `(${data.mailed}人にメールで知らせました)` : ""}${data.skipped ? `。同じ繰り返しのやること${data.skipped}件はもう入っているので入れませんでした` : ""}`,
      );
      setDrafts(null);
      setText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "うまくいきませんでした");
    } finally {
      setBusy(null);
    }
  }

  async function patch(t: Task, body: Record<string, unknown>) {
    setBusy(t.id);
    setError(null);
    try {
      const data = await call(`/api/tasks/${t.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      const { next, ...task } = data.task;
      setTasks((prev) => [
        ...prev.map((x) => (x.id === t.id ? task : x)),
        ...(next && !prev.some((x) => x.id === next.id) ? [next] : []),
      ]);
      setFlash(
        next ? `済みにしました。次の回(${md(next.dueOn)})を入れました` : null,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "うまくいきませんでした");
    } finally {
      setBusy(null);
    }
  }

  async function remove(t: Task) {
    if (!window.confirm(`「${t.title}」を消しますか?`)) return;
    setBusy(t.id);
    try {
      await call(`/api/tasks/${t.id}`, { method: "DELETE" });
      setTasks((prev) => prev.filter((x) => x.id !== t.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "うまくいきませんでした");
    } finally {
      setBusy(null);
    }
  }

  const input =
    "w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm";
  const setDraft = (i: number, p: Partial<TaskDraft>) =>
    setDrafts((d) => (d ? d.map((x, j) => (j === i ? { ...x, ...p } : x)) : d));
  const others = drafts
    ? [
        ...new Set(
          drafts
            .map((d) => d.ownerUserId)
            .filter((id): id is string => !!id && id !== viewerId),
        ),
      ]
        .map((id) => users.find((u) => u.id === id))
        .filter((u): u is User => !!u)
    : [];
  const mine = (t: Task) =>
    t.ownerUserId === viewerId || t.ownerUserId === null;
  const open = tasks.filter((t) => t.status === "OPEN");
  const shown = (
    filter === "done"
      ? tasks.filter((t) => t.status === "DONE")
      : open.filter((t) => filter === "open" || mine(t))
  ).sort((a, b) =>
    filter === "done"
      ? (b.doneAt ?? "").localeCompare(a.doneAt ?? "")
      : (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999") ||
        a.createdAt.localeCompare(b.createdAt),
  );
  const overdue = open.filter(
    (t) => mine(t) && t.dueOn && t.dueOn < today,
  ).length;

  // 期限の日が祝日なら名前を添える(休みの日に期限を置いていないか気づけるように)
  function dueBadge(t: Task) {
    const off = t.dueOn && t.status === "OPEN" ? holidayName(t.dueOn) : null;
    return (
      <>
        {dueText(t)}
        {off && <span className="text-xs text-rose-700">({off})</span>}
      </>
    );
  }

  function dueText(t: Task) {
    if (!t.dueOn)
      return <span className="text-xs text-slate-400">期限なし</span>;
    if (t.status === "DONE")
      return <span className="text-xs text-slate-500">{md(t.dueOn)}まで</span>;
    const d = days(t.dueOn, today);
    if (d < 0)
      return (
        <span className="rounded bg-rose-100 px-1.5 py-0.5 text-xs font-medium text-rose-800">
          {md(t.dueOn)}(期限から{-d}日)
        </span>
      );
    if (d === 0)
      return (
        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900">
          今日まで
        </span>
      );
    if (d === 1)
      return (
        <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-900">
          明日まで
        </span>
      );
    return <span className="text-xs text-slate-600">{md(t.dueOn)}まで</span>;
  }

  return (
    <div className="space-y-6">
      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <label className="block text-sm">
          <span className="text-slate-700">
            やること(1行に1つ。メールやメモを貼ってもかまいません)
          </span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            placeholder={
              "例: 明日までに田中さんがさくら商事に見積を送る\n来週金曜 請求書の確認 @山田\n月末までに在庫を数える"
            }
            className={`mt-1 ${input}`}
          />
        </label>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-slate-500">よくある定例の事務:</span>
          {ROUTINE_EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() =>
                setText((v) => (v.trim() ? `${v.trimEnd()}\n${ex}` : ex))
              }
              className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-slate-700 hover:bg-slate-50"
            >
              {ex}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => parse(false)}
            disabled={!!busy || !text.trim()}
            className="rounded-md bg-vermilion-600 px-4 py-2 text-sm font-medium text-white hover:bg-vermilion-700 disabled:opacity-50"
          >
            {busy === "parse" ? "分けています…" : "分ける"}
          </button>
          {ai && (
            <button
              onClick={() => parse(true)}
              disabled={!!busy || !text.trim()}
              className="rounded-md border border-indigo-300 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
            >
              {busy === "ai" ? "AIが拾っています…" : "AIで拾い出す"}
            </button>
          )}
        </div>
        {drafts && drafts.length > 0 && (
          <div className="space-y-3 border-t border-slate-100 pt-4">
            <p className="text-xs text-slate-500">
              {mode === "claude"
                ? "AIが拾い出しました。"
                : "決まったルールで分けました。"}
              直してから「登録する」を押してください。
            </p>
            <ul className="space-y-3">
              {drafts.map((d, i) => (
                <li
                  key={i}
                  className="grid gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-[1fr_9rem_9rem_8rem_11rem_auto] sm:items-center"
                >
                  <input
                    aria-label="やること"
                    value={d.title}
                    onChange={(e) => setDraft(i, { title: e.target.value })}
                    className={input}
                  />
                  <select
                    aria-label="担当"
                    value={d.ownerUserId ?? ""}
                    onChange={(e) =>
                      setDraft(i, { ownerUserId: e.target.value || null })
                    }
                    className={input}
                  >
                    <option value="">担当なし</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                  <input
                    aria-label="期限"
                    type="date"
                    value={d.due ?? ""}
                    onChange={(e) =>
                      setDraft(i, { due: e.target.value || null })
                    }
                    className={input}
                  />
                  <select
                    aria-label="繰り返し"
                    value={d.repeat ?? ""}
                    onChange={(e) =>
                      setDraft(i, { repeat: e.target.value || null })
                    }
                    className={input}
                  >
                    <option value="">繰り返さない</option>
                    {REPEAT_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="取引先"
                    value={d.partyId ? `${d.partyKind}:${d.partyId}` : ""}
                    onChange={(e) => {
                      const [kind, id] = e.target.value.split(":");
                      setDraft(i, {
                        partyKind: (kind as "customer" | "vendor") || null,
                        partyId: id || null,
                      });
                    }}
                    className={input}
                  >
                    <option value="">取引先なし</option>
                    {parties.map((p) => (
                      <option
                        key={`${p.kind}:${p.id}`}
                        value={`${p.kind}:${p.id}`}
                      >
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() =>
                      setDrafts((x) => (x ? x.filter((_, j) => j !== i) : x))
                    }
                    className="text-xs text-slate-500 hover:text-rose-700"
                  >
                    外す
                  </button>
                </li>
              ))}
            </ul>
            {others.length > 0 && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={notify}
                  onChange={(e) => setNotify(e.target.checked)}
                />
                担当の人({others.map((u) => u.name).join("・")}
                )にメールでも知らせる
                {others.some((u) => !u.email) && (
                  <span className="text-xs text-slate-500">
                    (メールアドレスがない人には送りません)
                  </span>
                )}
              </label>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                onClick={save}
                disabled={!!busy || drafts.some((d) => !d.title.trim())}
                className="rounded-md bg-vermilion-600 px-4 py-2 text-sm font-medium text-white hover:bg-vermilion-700 disabled:opacity-50"
              >
                {busy === "save"
                  ? "登録しています…"
                  : `${drafts.length}件を登録する`}
              </button>
              <button
                onClick={() => setDrafts(null)}
                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50"
              >
                やめる
              </button>
            </div>
          </div>
        )}
        {error && (
          <p className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-800">
            {error}
          </p>
        )}
        {flash && !drafts && (
          <p className="rounded-md bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
            {flash}
          </p>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2" role="tablist">
          {(
            [
              ["mine", `自分の ${open.filter(mine).length}`],
              ["open", `みんなの ${open.length}`],
              ["done", "済み(14日)"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              role="tab"
              aria-selected={filter === k}
              onClick={() => setFilter(k)}
              className={`rounded-full border px-3 py-1.5 text-sm ${filter === k ? "border-indigo-700 bg-indigo-700 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
            >
              {label}
            </button>
          ))}
          {overdue > 0 && filter !== "done" && (
            <span className="text-sm text-rose-700">
              期限を過ぎた自分のやることが{overdue}件あります
            </span>
          )}
        </div>
        {shown.length === 0 && (
          <p className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-500">
            {filter === "done"
              ? "済んだやることはありません"
              : "まだ済んでいないやることはありません"}
          </p>
        )}
        {shown.length > 0 && (
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white shadow-sm">
            {shown.map((t) => (
              <li
                key={t.id}
                className={`flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 ${t.status === "DONE" ? "opacity-70" : ""}`}
              >
                <input
                  type="checkbox"
                  aria-label={`${t.title}を${t.status === "DONE" ? "未済に戻す" : "済みにする"}`}
                  checked={t.status === "DONE"}
                  disabled={busy === t.id}
                  onChange={() =>
                    patch(t, { status: t.status === "DONE" ? "OPEN" : "DONE" })
                  }
                  className="h-5 w-5 accent-emerald-600"
                />
                <div className="min-w-0 flex-1">
                  <p
                    className={`text-sm ${t.status === "DONE" ? "text-slate-500 line-through" : "text-slate-900"}`}
                  >
                    {t.title}
                  </p>
                  <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-slate-500">
                    {dueBadge(t)}
                    {t.repeat && (
                      <span className="text-indigo-700">
                        🔁 {repeatLabel(t.repeat)}
                      </span>
                    )}
                    {t.partyKind && t.partyId && (
                      <Link
                        href={`/vendors/${t.partyKind}/${t.partyId}`}
                        className="underline"
                      >
                        {t.partyName ?? "取引先カルテ"}
                      </Link>
                    )}
                    {SOURCE[t.source] &&
                      (t.source === "MINUTES" && t.sourceId ? (
                        <Link
                          href={`/minutes/${t.sourceId}`}
                          className="underline"
                        >
                          {SOURCE[t.source]}から
                        </Link>
                      ) : (
                        <span>{SOURCE[t.source]}から</span>
                      ))}
                    <span>登録 {t.createdByName}</span>
                    {t.status === "DONE" && (
                      <span className="text-emerald-700">
                        済み{t.doneByName ? `(${t.doneByName})` : ""}
                      </span>
                    )}
                  </p>
                </div>
                <div className="ml-8 flex w-full flex-wrap items-center gap-2 sm:ml-0 sm:w-auto">
                  {t.status === "OPEN" && (
                    <>
                      <select
                        aria-label="担当"
                        value={t.ownerUserId ?? ""}
                        disabled={busy === t.id}
                        onChange={(e) =>
                          patch(t, { ownerUserId: e.target.value || null })
                        }
                        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
                      >
                        <option value="">担当なし</option>
                        {users.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name}
                          </option>
                        ))}
                      </select>
                      <input
                        aria-label="期限"
                        type="date"
                        value={t.dueOn ?? ""}
                        disabled={busy === t.id}
                        onChange={(e) =>
                          patch(t, { due: e.target.value || null })
                        }
                        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
                      />
                    </>
                  )}
                  <button
                    onClick={() => remove(t)}
                    disabled={busy === t.id}
                    className="text-xs text-slate-500 hover:text-rose-700"
                  >
                    消す
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

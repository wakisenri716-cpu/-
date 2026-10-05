"use client";

import { useState } from "react";
import { SparkleIcon } from "@/components/icons";

type Party = { id: string; name: string; uses: number; details: string[] };
type Group = { key: string; kind: "vendor" | "customer"; strength: "same" | "similar"; parties: Party[]; keepId: string; reason: string; aiNote: string | null; aiSame: boolean | null };
type Data = { groups: Group[]; review: { summary: string; mode: string; createdAt: string; createdBy: string } | null };

function GroupCard({ g, busy, onMerge, onDifferent }: { g: Group; busy: boolean; onMerge: (g: Group, keepId: string) => void; onDifferent: (g: Group) => void }) {
  const [keepId, setKeepId] = useState(g.keepId);
  return (
    <li className={`rounded-xl border bg-white p-4 shadow-sm ${g.strength === "same" ? "border-amber-300" : "border-slate-200"}`}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs whitespace-nowrap text-slate-700">{g.kind === "vendor" ? "仕入先・支払先" : "顧客"}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs whitespace-nowrap ${g.strength === "same" ? "bg-amber-100 text-amber-800" : "bg-sky-100 text-sky-800"}`}>{g.strength === "same" ? "同じ名前" : "似ている名前"}</span>
        <span className="text-slate-600">{g.reason}</span>
      </div>
      {g.aiNote && (
        <p className={`mt-2 flex items-start gap-1 text-sm ${g.aiSame ? "text-indigo-800" : "text-rose-700"}`}>
          <SparkleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {g.aiSame ? "同じ相手のようです" : "別の相手かもしれません"}: {g.aiNote}
        </p>
      )}
      <ul className="mt-3 space-y-2">
        {g.parties.map((p) => (
          <li key={p.id}>
            <label className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2 ${keepId === p.id ? "border-indigo-300 bg-indigo-50/50" : "border-slate-200"}`}>
              <input type="radio" name={g.key} checked={keepId === p.id} onChange={() => setKeepId(p.id)} className="mt-1" />
              <span className="min-w-0">
                <span className="block font-medium break-words">
                  {p.name}
                  {keepId === p.id && <span className="ml-2 text-xs font-normal text-indigo-700">残す</span>}
                </span>
                <span className="block text-xs break-words text-slate-600">{p.details.join("・")}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          disabled={busy}
          onClick={() => {
            if (confirm(`「${g.parties.find((p) => p.id === keepId)?.name}」に1つにまとめます。まとめた方は消えます。よろしいですか?`)) onMerge(g, keepId);
          }}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          選んだ方にまとめる
        </button>
        <button disabled={busy} onClick={() => onDifferent(g)} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          別の相手
        </button>
      </div>
    </li>
  );
}

export function PartyDuplicatesView({ initial }: { initial: Data }) {
  const [data, setData] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  async function post(body: object) {
    setBusy(true);
    setError(null);
    setMessage(null);
    const res = await fetch("/api/party-duplicates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(json.error || "できませんでした");
    setData(json);
    if (json.merged) setMessage(`「${json.merged.merged.join("」「")}」を「${json.merged.keep}」にまとめました`);
  }
  return (
    <>
      <section className="rounded-xl border border-indigo-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-1.5 font-semibold text-indigo-900">
            <SparkleIcon className="h-4 w-4" />
            AIの見立て
          </h2>
          <button onClick={() => post({ action: "review" })} disabled={busy} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
            {busy ? "処理しています…" : data.review ? "もう一度AIに見てもらう" : "同じ相手かAIに見てもらう"}
          </button>
        </div>
        {data.review ? (
          <>
            <p className="mt-2 text-sm">{data.review.summary}</p>
            <p className="mt-1 text-xs text-slate-500">
              {data.review.mode === "claude" ? "AIが見立てました" : "決まったルールでまとめました"}({new Date(data.review.createdAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}・{data.review.createdBy})。まとめるのはボタンを押したときだけです。
            </p>
          </>
        ) : (
          <p className="mt-2 text-sm text-slate-500">名前・登録番号・住所などを読んで、同じ相手かどうかをAIが組ごとに見立てます。</p>
        )}
      </section>
      {error && <p className="text-sm text-rose-700">{error}</p>}
      {message && <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">✓ {message}</p>}
      {data.groups.length === 0 ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">重複している取引先は見つかりませんでした。</div>
      ) : (
        <ul className="space-y-3">
          {data.groups.map((g) => (
            <GroupCard key={g.key} g={g} busy={busy} onMerge={(x, keepId) => post({ action: "merge", kind: x.kind, keepId, mergeIds: x.parties.map((p) => p.id).filter((id) => id !== keepId) })} onDifferent={(x) => post({ action: "different", key: x.key })} />
          ))}
        </ul>
      )}
    </>
  );
}

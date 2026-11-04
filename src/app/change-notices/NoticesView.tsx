"use client";

import { useState } from "react";

type Values = { address?: string | null; phone?: string | null; name?: string | null; kana?: string | null; emergencyName?: string | null; emergencyPhone?: string | null; emergencyRelation?: string | null };
type Row = { id: string; userName: string; kind: string; kindLabel: string; values: Values; effectiveOn: string | null; note: string | null; status: string; reply: string | null; decidedByName: string | null; createdAt: string; staffId: string | null; current: { name: string; address: string | null; phone: string | null; kana: string | null; emergencyName: string | null; emergencyPhone: string | null } | null; followUps: string[] };
const LABEL: Record<string, string> = { address: "住所", phone: "電話", name: "名前", kana: "ふりがな", emergencyName: "緊急連絡先", emergencyPhone: "緊急連絡先の電話", emergencyRelation: "続きがら" };
const CUR: Record<string, keyof NonNullable<Row["current"]>> = { address: "address", phone: "phone", name: "name", kana: "kana", emergencyName: "emergencyName", emergencyPhone: "emergencyPhone" };

export default function NoticesView({ initial }: { initial: Row[] }) {
  const [rows, setRows] = useState(initial);
  const [todo, setTodo] = useState<{ name: string; items: string[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function act(r: Row, action: "apply" | "reject") {
    let reply = "";
    if (action === "reject") {
      reply = prompt("確かめが必要な理由(本人に知らせます)") ?? "";
      if (!reply.trim()) return;
    }
    setBusy(r.id);
    setError(null);
    try {
      const res = await fetch(`/api/change-notices/${r.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, reply }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "うまくいきませんでした");
      setRows(rows.map((x) => (x.id === r.id ? { ...x, status: action === "apply" ? "APPLIED" : "REJECTED", reply: reply || null } : x)));
      if (action === "apply") setTodo({ name: r.userName, items: json.followUps ?? [] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "うまくいきませんでした");
    } finally {
      setBusy(null);
    }
  }
  const pending = rows.filter((r) => r.status === "REQUESTED");
  const done = rows.filter((r) => r.status !== "REQUESTED");

  return (
    <div className="space-y-6">
      {error && <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}
      {todo && (
        <section className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 text-sm">
          <p className="font-medium text-emerald-900">{todo.name}さんの名簿を直しました。</p>
          {todo.items.length > 0 && (
            <>
              <p className="mt-1 text-emerald-900">あわせて確かめること:</p>
              <ul className="mt-1 list-disc pl-5 text-emerald-900">
                {todo.items.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
      <section className="space-y-3 rounded-xl border border-amber-200 bg-white p-4 text-sm shadow-sm">
        <h2 className="font-semibold">確認待ち({pending.length}件)</h2>
        {pending.length ? (
          pending.map((r) => (
            <div key={r.id} className="space-y-2 rounded-md border border-slate-200 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{r.userName}</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">{r.kindLabel}</span>
                {r.effectiveOn && <span className="text-xs text-slate-500">{r.effectiveOn}から</span>}
                {!r.staffId && <span className="text-xs text-rose-700">スタッフ登録とひも付いていません</span>}
              </div>
              <table className="w-full text-left text-xs">
                <thead className="text-slate-500">
                  <tr>
                    <th className="w-32 py-1 font-normal"></th>
                    <th className="font-normal">いまの名簿</th>
                    <th className="font-normal">新しい</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(r.values)
                    .filter(([, val]) => val)
                    .map(([k, val]) => (
                      <tr key={k} className="border-t border-slate-100">
                        <td className="py-1 text-slate-600">{LABEL[k] ?? k}</td>
                        <td className="text-slate-500">{CUR[k] && r.current ? (r.current[CUR[k]] ?? "(なし)") : ""}</td>
                        <td className="font-medium">{val}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
              {r.note && <p className="text-xs text-slate-600">「{r.note}」</p>}
              <div className="flex gap-2">
                <button onClick={() => act(r, "apply")} disabled={!!busy || !r.staffId} className="rounded-md bg-vermilion-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
                  名簿に入れる
                </button>
                <button onClick={() => act(r, "reject")} disabled={!!busy} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs hover:bg-slate-50">
                  確かめが必要
                </button>
              </div>
            </div>
          ))
        ) : (
          <p className="text-slate-500">確認待ちの届け出はありません。</p>
        )}
      </section>
      {done.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
          <h2 className="font-semibold">これまで(半年)</h2>
          <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
            {done.map((r) => (
              <li key={r.id}>
                {new Date(r.createdAt).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" })} {r.userName} {r.kindLabel} — {r.status === "APPLIED" ? "名簿に入れた" : `確かめが必要(${r.reply})`}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

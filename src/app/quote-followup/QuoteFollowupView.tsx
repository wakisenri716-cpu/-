"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FollowRow, FollowStage } from "@/lib/quoteFollowup";

const STAGE: Record<FollowStage, { label: string; className: string }> = {
  EXPIRING: { label: "期限まぢか", className: "bg-rose-50 text-rose-800 ring-rose-200" },
  FOLLOW: { label: "追いかけどき", className: "bg-amber-50 text-amber-900 ring-amber-200" },
  UNSENT: { label: "まだ送っていない", className: "bg-indigo-50 text-indigo-800 ring-indigo-200" },
  EXPIRED: { label: "期限切れ", className: "bg-slate-100 text-slate-700 ring-slate-200" },
  WAIT: { label: "返事待ち", className: "bg-emerald-50 text-emerald-800 ring-emerald-200" },
};
const yen = (n: number) => `¥${n.toLocaleString("ja-JP")}`;
const md = (k: string | null) => (k ? `${Number(k.slice(5, 7))}/${Number(k.slice(8, 10))}` : "-");
type Draft = { to: string; subject: string; body: string; mode: "claude" | "template" };

export default function QuoteFollowupView({ initial, ai }: { initial: { rows: FollowRow[]; totalOpen: number; needAction: number }; ai: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  async function call(url: string, init: RequestInit) {
    const res = await fetch(url, { headers: { "content-type": "application/json" }, ...init });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "うまくいきませんでした");
    return data;
  }
  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "うまくいきませんでした");
    } finally {
      setBusy(null);
    }
  }

  const makeDraft = (id: string, useAi: boolean) =>
    run(useAi ? "ai" : "draft", async () => {
      setOpen(id);
      setFlash(null);
      setDraft(await call(`/api/quote-followup/${id}`, { method: "POST", body: JSON.stringify({ useAi, notes }) }));
    });
  const send = (id: string) =>
    run("send", async () => {
      if (!draft) return;
      const log = await call("/api/mail/send", { method: "POST", body: JSON.stringify({ kind: "quote", id, to: draft.to, subject: draft.subject, body: draft.body }) });
      setFlash(log.status === "TEST" ? "テストモードのため実際には送っていません(記録には残しました)" : `${log.to} に送りました`);
      setDraft(null);
      setOpen(null);
      router.refresh();
    });
  const extend = (id: string) =>
    run(id, async () => {
      const r = await call(`/api/quote-followup/${id}`, { method: "PATCH", body: JSON.stringify({ days: 30 }) });
      setFlash(`有効期限を${md(r.validUntil)}まで延ばしました`);
      router.refresh();
    });
  const cancel = (id: string, no: string) =>
    run(id, async () => {
      if (!window.confirm(`見積書 ${no} を取り消しますか?(断られた・失注したとき)`)) return;
      await call(`/api/quotes/${id}/cancel`, { method: "POST" });
      setFlash(`見積書 ${no} を取り消しました`);
      router.refresh();
    });

  const input = "mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm";
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-500">返事待ちの見積</div>
          <div className="mt-1 text-xl font-semibold tabular-nums">{initial.rows.length}件</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-500">見積の合計(税込)</div>
          <div className="mt-1 text-xl font-semibold tabular-nums">{yen(initial.totalOpen)}</div>
        </div>
        <div className={`rounded-xl border p-4 shadow-sm ${initial.needAction ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white"}`}>
          <div className="text-xs text-slate-500">いま追いかけたい見積</div>
          <div className="mt-1 text-xl font-semibold tabular-nums">{initial.needAction}件</div>
        </div>
      </div>
      {flash && <p className="rounded-md bg-emerald-50 px-4 py-2 text-sm text-emerald-800">{flash}</p>}
      {error && <p className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-800">{error}</p>}
      {initial.rows.length === 0 && <p className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-sm text-slate-500">返事待ちの見積書はありません。</p>}
      {initial.rows.map((r) => (
        <article key={r.id} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className={`rounded-full px-2.5 py-0.5 text-xs ring-1 ${STAGE[r.stage].className}`}>{STAGE[r.stage].label}</span>
            <Link href={`/quotes/${r.id}`} className="font-semibold hover:text-indigo-700 hover:underline">
              {r.quoteNumber}
            </Link>
            <Link href={`/vendors/customer/${r.customer.id}`} className="text-sm text-slate-700 hover:underline">
              {r.customer.name}
            </Link>
            <span className="ml-auto text-lg font-semibold tabular-nums">{yen(r.total)}</span>
          </div>
          <p className="text-xs text-slate-600">
            見積日 {md(r.issueDate)}({r.daysSinceIssue}日前) ・ 有効期限 {md(r.validUntil)}({r.daysLeft >= 0 ? `あと${r.daysLeft}日` : `${-r.daysLeft}日過ぎ`}) ・ {r.sentAt ? `送った日 ${md(r.sentAt)}${r.followups ? `・追いかけ ${r.followups}回(最後 ${md(r.lastMailAt)})` : ""}` : "まだメールで送っていません"}
          </p>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => makeDraft(r.id, false)} disabled={!!busy} className="rounded-md bg-vermilion-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
              {busy === "draft" && open === r.id ? "作っています…" : r.stage === "UNSENT" ? "送るメールを作る" : "追いかけのメールを作る"}
            </button>
            {ai && (
              <button onClick={() => makeDraft(r.id, true)} disabled={!!busy} className="rounded-md border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50">
                {busy === "ai" && open === r.id ? "AIが書いています…" : "AIで書く"}
              </button>
            )}
            <button onClick={() => extend(r.id)} disabled={!!busy} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs hover:bg-slate-50 disabled:opacity-50">
              期限を30日延ばす
            </button>
            <button onClick={() => cancel(r.id, r.quoteNumber)} disabled={!!busy} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50">
              取り消す(失注)
            </button>
          </div>
          {open === r.id && ai && !draft && (
            <label className="block text-sm">
              <span className="text-slate-700">AIに伝えること(任意)</span>
              <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="例: 今月中のご発注なら納期を1週間早められる" className={input} />
            </label>
          )}
          {open === r.id && draft && (
            <div className="space-y-2 border-t border-slate-100 pt-3">
              <p className="text-xs text-slate-500">{draft.mode === "claude" ? "AIが書きました。" : "ひな形の下書きです。"}直してから送ってください。</p>
              <label className="block text-sm">
                <span className="text-slate-700">宛先</span>
                <input value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} placeholder="メールアドレス" className={input} />
              </label>
              <label className="block text-sm">
                <span className="text-slate-700">件名</span>
                <input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} className={input} />
              </label>
              <label className="block text-sm">
                <span className="text-slate-700">本文</span>
                <textarea value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} rows={14} className={input} />
              </label>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => send(r.id)} disabled={!!busy || !draft.to.trim()} className="rounded-md bg-vermilion-600 px-4 py-2 text-sm font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
                  {busy === "send" ? "送っています…" : "メールで送る"}
                </button>
                <button onClick={() => setDraft(null)} className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50">
                  やめる
                </button>
              </div>
            </div>
          )}
        </article>
      ))}
    </div>
  );
}

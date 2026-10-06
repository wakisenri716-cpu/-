"use client";

import { useState } from "react";

export type Proposal = { id: string; kind: "INVOICE" | "JOURNAL" | "REMINDER" | "END_CONTRACT" | "LINK_PO" | "CANCEL_INVOICE" | "VENDOR_ACCOUNT" | "EXPENSE" | "FIX_ACCOUNT"; summary: string; details: string[]; status: string; resultNote: string | null };

const KIND_LABEL: Record<Proposal["kind"], string> = {
  INVOICE: "請求書の下書き",
  JOURNAL: "仕訳の下書き",
  REMINDER: "督促メールの下書き",
  END_CONTRACT: "契約の終了",
  LINK_PO: "発注書の検収",
  CANCEL_INVOICE: "請求書の取り消し",
  VENDOR_ACCOUNT: "取引先の科目",
  EXPENSE: "経費の入力",
  FIX_ACCOUNT: "科目の振替",
};
const ACTION_LABEL: Record<Proposal["kind"], string> = {
  INVOICE: "この内容で請求書を発行する",
  JOURNAL: "この内容で記帳する",
  REMINDER: "この内容でメールを送る",
  END_CONTRACT: "契約を終了にする",
  LINK_PO: "この請求書で検収する",
  CANCEL_INVOICE: "この請求書を取り消す",
  VENDOR_ACCOUNT: "この科目にする",
  EXPENSE: "経費精算に入れる",
  FIX_ACCOUNT: "振替の仕訳を作って直す",
};

// AIの下書き。人がボタンを押したときだけ実行する
export function ProposalCard({ proposal, onChange, note }: { proposal: Proposal; onChange: (p: Proposal) => void; note?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function act(action: "execute" | "cancel") {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/assistant/proposals/${proposal.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(json.error || "できませんでした");
    onChange({ ...proposal, status: json.status, resultNote: json.resultNote ?? null });
  }
  return (
    <div className={`mt-3 rounded-xl border p-3 ${proposal.status === "DONE" ? "border-emerald-200 bg-emerald-50" : proposal.status === "CANCELLED" ? "border-slate-200 bg-slate-50 opacity-70" : "border-indigo-200 bg-indigo-50/50"}`}>
      <p className="text-xs font-medium text-indigo-700">{KIND_LABEL[proposal.kind]}</p>
      {note && <p className="text-xs text-slate-500">{note}</p>}
      <p className="font-medium">{proposal.summary}</p>
      <ul className="mt-1 space-y-0.5 text-xs text-slate-700">
        {proposal.details.map((d, i) => (
          <li key={i}>{d}</li>
        ))}
      </ul>
      {error && <p className="mt-2 text-xs text-rose-700">{error}</p>}
      {proposal.status === "PENDING" ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <button disabled={busy} onClick={() => act("execute")} className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
            {ACTION_LABEL[proposal.kind]}
          </button>
          <button disabled={busy} onClick={() => act("cancel")} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            やめる
          </button>
        </div>
      ) : (
        <p className="mt-2 text-xs font-medium text-slate-700">{proposal.status === "DONE" ? `✓ ${proposal.resultNote ?? "実行しました"}` : "やめました"}</p>
      )}
    </div>
  );
}

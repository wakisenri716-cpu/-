"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ContactForm } from "@/components/ContactForm";

type Party = {
  kind: "customer" | "vendor";
  id: string;
  name: string;
  postalCode: string | null;
  address: string | null;
  department: string | null;
  contactName: string | null;
  honorific: string | null;
  phone: string | null;
};

const KIND = { customer: "顧客", vendor: "取引先" } as const;

export default function LettersPage() {
  const [parties, setParties] = useState<Party[] | null>(null);
  const [tab, setTab] = useState<"all" | "customer" | "vendor">("all");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Party | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/address-book");
    if (res.ok) setParties(await res.json());
  }, []);

  useEffect(() => {
    // Fetch-on-mount: setState always lands after the fetch's await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const key = (p: Party) => `${p.kind}:${p.id}`;
  const shown = (parties ?? []).filter((p) => (tab === "all" || p.kind === tab) && (!q || `${p.name}${p.address ?? ""}${p.contactName ?? ""}`.includes(q)));
  const withAddress = shown.filter((p) => p.address);
  const toggle = (p: Party) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key(p))) next.delete(key(p));
      else next.add(key(p));
      return next;
    });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">宛名・送付状</h1>
        <p className="mt-1 text-sm text-slate-600">
          顧客・取引先の住所録です。住所と宛名を入れておくと、送付状(書類に添える案内状)・封筒(長形3号)・宛名ラベル(A4 12面)を印刷でき、請求書・見積書・発注書の宛先にも住所が載ります。
        </p>
        <p className="mt-2 text-sm">
          <Link href="/letters/greeting" className="text-indigo-700 hover:underline">
            挨拶状・お礼状を作る(お礼・年末年始の休業・移転・担当者の交代・お詫び・新しいご案内)→
          </Link>
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1 text-sm">
          {(["all", "customer", "vendor"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`rounded-md px-3 py-1 ${tab === t ? "bg-white font-medium shadow-sm" : "text-slate-600"}`}>
              {t === "all" ? "すべて" : KIND[t]}
            </button>
          ))}
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="名前・住所で探す" className="w-56 rounded-md border px-3 py-1.5 text-sm" aria-label="探す" />
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm">
        <span>
          選んだ相手: <span className="font-semibold">{selected.size}件</span>
        </span>
        <button onClick={() => setSelected(new Set(withAddress.map(key)))} className="text-xs text-indigo-700 hover:underline">
          住所のある相手をすべて選ぶ
        </button>
        <button onClick={() => setSelected(new Set())} className="text-xs text-slate-500 hover:underline">
          選択をやめる
        </button>
        <Link
          href={selected.size ? `/letters/labels?keys=${[...selected].join(",")}` : "#"}
          aria-disabled={!selected.size}
          className={`ml-auto rounded-md px-4 py-2 font-medium text-white ${selected.size ? "bg-vermilion-600 hover:bg-vermilion-700" : "pointer-events-none bg-indigo-300"}`}
        >
          宛名ラベルを印刷(A4 12面)
        </Link>
      </div>

      {parties && (
        <ul className="divide-y overflow-hidden rounded-xl border border-slate-200 bg-white text-sm shadow-sm">
          {shown.map((p) => (
            <li key={key(p)} className="flex flex-wrap items-start gap-3 px-4 py-3">
              <input type="checkbox" checked={selected.has(key(p))} onChange={() => toggle(p)} disabled={!p.address} className="mt-1" aria-label={`${p.name}を選ぶ`} />
              <div className="min-w-0 flex-1">
                <div className="font-medium">
                  {p.name}
                  <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{KIND[p.kind]}</span>
                </div>
                <div className="text-xs text-slate-500">
                  {p.address ? `〒${p.postalCode ?? "   -    "} ${p.address}` : <span className="text-amber-700">住所が未入力です</span>}
                  {(p.department || p.contactName) && ` ・ ${[p.department, p.contactName && `${p.contactName} 様`].filter(Boolean).join(" ")}`}
                </div>
              </div>
              <div className="flex flex-wrap gap-3 text-xs">
                <button onClick={() => setEditing(p)} className="text-indigo-700 hover:underline">
                  住所・宛名を編集
                </button>
                <Link href={`/letters/cover?kind=${p.kind}&id=${p.id}`} className="text-indigo-700 hover:underline">
                  送付状
                </Link>
                {p.address && (
                  <Link href={`/letters/envelope?kind=${p.kind}&id=${p.id}`} className="text-indigo-700 hover:underline">
                    封筒
                  </Link>
                )}
              </div>
            </li>
          ))}
          {shown.length === 0 && <li className="px-4 py-6 text-center text-slate-400">相手がいません。請求書・発注書を作ると、ここに出てきます。</li>}
        </ul>
      )}

      {editing && (
        <div className="fixed inset-0 z-20 flex items-end justify-center bg-slate-900/30 p-4 sm:items-center" onClick={() => setEditing(null)}>
          <div onClick={(e) => e.stopPropagation()} className="max-h-[90vh] w-full max-w-2xl space-y-3 overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
            <h2 className="font-semibold">{editing.name} の住所・宛名</h2>
            <ContactForm
              kind={editing.kind}
              id={editing.id}
              values={editing}
              onSaved={async () => {
                await load();
                setEditing(null);
              }}
              onCancel={() => setEditing(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

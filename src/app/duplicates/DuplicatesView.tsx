"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { formatYen } from "@/lib/format";

type Item = { kind: "EXPENSE" | "INVOICE"; id: string; date: string; amount: number; vendorName: string | null; label: string; who: string | null };
type Group = { key: string; level: "HIGH" | "MEDIUM" | "LOW"; reason: string; items: Item[]; date: string; amount: number };
type Data = { groups: Group[]; dismissedCount: number; days: number };

const LEVEL = {
  HIGH: { label: "重複の可能性が高い", cls: "bg-rose-100 text-rose-800" },
  MEDIUM: { label: "重複かもしれない", cls: "bg-amber-100 text-amber-800" },
  LOW: { label: "念のため確認", cls: "bg-slate-100 text-slate-600" },
};

export function DuplicatesView() {
  const [data, setData] = useState<Data | null>(null);
  const [showLow, setShowLow] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/duplicates");
    if (res.ok) setData(await res.json());
  }, []);

  useEffect(() => {
    // Fetch-on-mount: setState always lands after the fetch's await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function dismiss(g: Group) {
    setBusy(g.key);
    const res = await fetch("/api/duplicates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: g.items.map((i) => i.id) }) });
    setBusy(null);
    if (res.ok) await load();
  }

  if (!data) return null;
  const low = data.groups.filter((g) => g.level === "LOW").length;
  const shown = data.groups.filter((g) => showLow || g.level !== "LOW");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">二重計上のチェック</h1>
        <p className="mt-1 text-sm text-slate-600">
          直近{data.days}日の経費精算の明細と受け取った請求書から、同じものを2回記帳していそうな組み合わせを探します(同じ画像・同じ請求書番号・同じ日の同じ金額と取引先)。本当に重複していたら、経費精算や請求書の画面で片方を消してください。別々のものなら「重複ではない」を押すと、次から出なくなります。
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span>
          候補 <span className="font-semibold">{data.groups.length - low}件</span>
          {low > 0 && `(ほかに念のため確認 ${low}件)`}
        </span>
        {low > 0 && (
          <label className="flex items-center gap-1 text-slate-600">
            <input type="checkbox" checked={showLow} onChange={(e) => setShowLow(e.target.checked)} />
            念のため確認も出す
          </label>
        )}
        {data.dismissedCount > 0 && <span className="text-xs text-slate-500">「重複ではない」にした組み合わせ {data.dismissedCount}件</span>}
      </div>

      <div className="space-y-3">
        {shown.map((g) => (
          <section key={g.key} className="rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${LEVEL[g.level].cls}`}>{LEVEL[g.level].label}</span>
                <p className="mt-1 text-slate-600">{g.reason}</p>
              </div>
              <button disabled={busy === g.key} onClick={() => dismiss(g)} className="rounded-md border border-slate-300 px-3 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                重複ではない
              </button>
            </div>
            <ul className="mt-3 divide-y rounded-lg border">
              {g.items.map((i) => (
                <li key={i.id} className="flex items-start justify-between gap-3 px-3 py-2">
                  <span className="min-w-0">
                    <span className="mr-2 rounded bg-slate-100 px-1 text-xs text-slate-600">{i.kind === "EXPENSE" ? "経費" : "請求書"}</span>
                    <span className="tabular-nums text-slate-500">{i.date.replaceAll("-", "/")}</span> {i.label}
                    <span className="block text-xs text-slate-500">
                      {i.vendorName ?? "取引先なし"}
                      {i.who && `・${i.who}さん`}
                      {" ・ "}
                      <Link href={i.kind === "EXPENSE" ? "/expenses" : "/invoices?direction=RECEIVED"} className="text-indigo-700 hover:underline">
                        {i.kind === "EXPENSE" ? "経費精算を開く" : "受け取った請求書を開く"}
                      </Link>
                    </span>
                  </span>
                  <span className="whitespace-nowrap tabular-nums">{formatYen(i.amount)}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {shown.length === 0 && <p className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">二重計上の候補はありません。</p>}
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { formatYen } from "@/lib/format";

type Invoice = { id: string; invoiceNumber: string | null; party: string; issueDate: string | null; dueDate: string | null; totalAmount: number; remaining: number; payerMatch: boolean };
type Proposal = { invoiceIds: string[]; fee: number; label: string };
type Data = { row: { id: string; date: string; description: string; amount: number; deposit: boolean; bankName: string }; invoices: Invoice[]; proposals: Proposal[]; maxFee: number };

const slash = (d: string | null) => (d ? d.replaceAll("-", "/") : "-");

export function MatchView({ id }: { id: string }) {
  const router = useRouter();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [fee, setFee] = useState("");
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/bank/${id}/match`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return setError(json.error || "読み込めませんでした");
    setData(json);
  }, [id]);

  useEffect(() => {
    // Fetch-on-mount: setState always lands after the fetch's await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  function pick(p: Proposal) {
    setSelected(new Set(p.invoiceIds));
    setFee(p.fee ? String(p.fee) : "");
  }

  function toggle(invId: string, on: boolean) {
    setSelected((s) => {
      const n = new Set(s);
      if (on) n.add(invId);
      else n.delete(invId);
      return n;
    });
  }

  async function settle() {
    if (!data) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/bank/${id}/match`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ invoiceIds: [...selected], fee: Number(fee) || 0 }) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(json.error || "消込めませんでした");
    router.push("/bank");
    router.refresh();
  }

  if (!data) return error ? <p className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</p> : null;
  const { row } = data;
  const feeNum = row.deposit ? Number(fee) || 0 : 0;
  const chosen = data.invoices.filter((i) => selected.has(i.id));
  const total = chosen.reduce((s, i) => s + i.remaining, 0);
  const diff = total - row.amount - feeNum; // プラスなら最後の請求書が一部入金で残る
  const q = filter.trim();
  const shown = data.invoices.filter((i) => !q || i.party.includes(q) || (i.invoiceNumber ?? "").includes(q) || String(i.remaining).includes(q.replace(/[,円]/g, "")));

  return (
    <div className="space-y-5">
      <div>
        <Link href="/bank" className="text-sm text-indigo-700 hover:underline">
          ← 銀行・カード明細
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">{row.deposit ? "入金" : "支払"}を請求書と消込む</h1>
        <p className="mt-1 text-sm text-slate-600">
          1回の{row.deposit ? "入金" : "支払"}で何件かの請求書をまとめて消込めます。{row.deposit && "先方が振込手数料を差し引いて入金したときは、差額を「振込手数料」に入れると支払手数料として記帳し、請求書は全額入金済みになります。"}
        </p>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <p className="text-slate-500">
              {slash(row.date)}・{row.bankName}
            </p>
            <p className="font-medium">{row.description}</p>
          </div>
          <p className="text-2xl font-semibold tabular-nums">{formatYen(row.amount)}</p>
        </div>
      </section>

      {data.proposals.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">金額が合う候補</h2>
          <div className="flex flex-wrap gap-2">
            {data.proposals.map((p, i) => (
              <button key={i} onClick={() => pick(p)} className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-left text-xs text-indigo-800 hover:bg-indigo-100">
                {p.label}
              </button>
            ))}
          </div>
        </section>
      )}

      {error && <p className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</p>}

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
          <h2 className="text-sm font-semibold">{row.deposit ? "入金待ちの請求書(発行)" : "支払待ちの請求書(受領)"}</h2>
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="取引先・番号・金額で絞り込み" className="w-56 max-w-full rounded-md border px-2 py-1 text-sm" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs whitespace-nowrap text-slate-500">
              <tr>
                <th className="px-3 py-2" />
                <th className="px-3 py-2">取引先</th>
                <th className="px-3 py-2">番号</th>
                <th className="px-3 py-2">期日</th>
                <th className="px-3 py-2 text-right">請求額</th>
                <th className="px-3 py-2 text-right">残り</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {shown.map((inv) => (
                <tr key={inv.id} className={selected.has(inv.id) ? "bg-indigo-50/50" : ""}>
                  <td className="px-3 py-2">
                    <input type="checkbox" checked={selected.has(inv.id)} onChange={(e) => toggle(inv.id, e.target.checked)} aria-label={`${inv.party} ${inv.invoiceNumber ?? ""}を選ぶ`} />
                  </td>
                  <td className="min-w-[8rem] px-3 py-2">
                    {inv.party}
                    {inv.payerMatch && <span className="ml-1 rounded bg-emerald-100 px-1 text-xs text-emerald-800">振込名義が一致</span>}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{inv.invoiceNumber ?? "-"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{slash(inv.dueDate)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">{formatYen(inv.totalAmount)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">{formatYen(inv.remaining)}</td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                    消込める請求書がありません。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
        <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
          <p className="flex justify-between">
            <span>選んだ請求書の残り({chosen.length}件)</span>
            <span className="tabular-nums">{formatYen(total)}</span>
          </p>
          <p className="flex justify-between">
            <span>{row.deposit ? "入金額" : "支払額"}</span>
            <span className="tabular-nums">{formatYen(row.amount)}</span>
          </p>
          {row.deposit && (
            <label className="flex items-center justify-between gap-2">
              <span>
                振込手数料(先方が差し引いた額)
                <span className="block text-xs text-slate-500">{data.maxFee.toLocaleString()}円まで・支払手数料にします</span>
              </span>
              <input value={fee} onChange={(e) => setFee(e.target.value)} inputMode="numeric" placeholder="0" className="w-24 rounded-md border px-2 py-1 text-right tabular-nums" />
            </label>
          )}
          <p className={`flex justify-between font-medium ${chosen.length && diff < 0 ? "text-rose-700" : ""}`}>
            <span>差</span>
            <span className="tabular-nums">
              {chosen.length === 0 ? "-" : diff === 0 ? "ぴったり" : diff > 0 ? `最後の請求書に ${formatYen(diff)} 残ります` : `${formatYen(-diff)} 多すぎます`}
            </span>
          </p>
        </div>
        <button disabled={busy || chosen.length === 0 || diff < 0} onClick={settle} className="w-full rounded-md bg-vermilion-600 px-4 py-2 font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
          {chosen.length}件の請求書と消込む
        </button>
        <p className="text-xs text-slate-500">期日の古い請求書から順に充てます。残りが出るのは最後の1件だけです(一部入金)。消込むと、この摘要を顧客の「振込名義」として覚え、次からは同じ名義の入金を候補に出し、合計が合えば取り込みのときに自動で消込みます。</p>
      </section>
    </div>
  );
}

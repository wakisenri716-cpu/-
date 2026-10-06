"use client";

import Link from "next/link";
import { useState } from "react";
import type { getPriceReview } from "@/lib/priceReview";
import { newPrice, simulatePriceIncrease } from "@/lib/priceMath";
import { formatYen } from "@/lib/format";

type Review = Awaited<ReturnType<typeof getPriceReview>>;
type Letter = { letter: string; advice: string | null; mode: "claude" | "template" };

const pctText = (v: number | null) => (v === null ? "-" : `${Math.round(v * 1000) / 10}%`);
const monthText = (m: string) => `${m.slice(0, 4)}/${Number(m.slice(5))}`;

export default function PriceReviewView({ review, ai, defaultEffective }: { review: Review; ai: boolean; defaultEffective: string }) {
  const [raise, setRaise] = useState(review.neededPct && review.neededPct > 0 ? Math.min(20, Math.ceil(review.neededPct)) : 5);
  const [loss, setLoss] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set(review.items.filter((i) => !i.changed && i.months >= 6).map((i) => i.label)));
  const [effective, setEffective] = useState(defaultEffective);
  const [note, setNote] = useState("");
  const [letter, setLetter] = useState<Letter | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const valid = raise > 0 && raise <= 100 && loss >= 0 && loss <= 90;
  const sim = valid ? simulatePriceIncrease(review.monthly, raise, loss) : null;
  const rows = valid ? [0, 5, 10, 20].map((l) => simulatePriceIncrease(review.monthly, raise, l)) : [];
  const basisLabel = review.period.basis === "lastYear" ? "前年の同じ時期" : "その前の3か月";

  async function draft() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/price-review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ raisePct: raise, lossPct: loss, effectiveDate: effective, items: [...selected], note }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "作れませんでした");
      setLetter(body);
      setCopied(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "作れませんでした");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">値上げの検討</h1>
        <p className="mt-1 text-sm text-slate-600">
          直近3か月(今月を除く)の費用の上がり方と利益率を{basisLabel}と比べ、利益率を戻すのに必要な値上げの目安と、値上げした場合の利益の増え方を出します。取引先へのお知らせ文{ai ? "も AI が" : "の下書きも"}作ります。何も保存しません。
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-500">利益率({basisLabel} → 直近3か月)</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">
            {pctText(review.margin.base)} → <span className={review.margin.recent !== null && review.margin.base !== null && review.margin.recent < review.margin.base ? "text-rose-700" : ""}>{pctText(review.margin.recent)}</span>
          </div>
          <div className="text-xs text-slate-500">
            記帳のある{review.bookedMonths.base}か月・{review.bookedMonths.recent}か月の平均 ·{" "}
            {monthText(review.period.base.from)}〜{monthText(review.period.base.to)} / {monthText(review.period.recent.from)}〜{monthText(review.period.recent.to)}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-500">売上総利益率(売上 − 売上原価)</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">
            {pctText(review.grossMargin.base)} → {pctText(review.grossMargin.recent)}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-500">利益率を戻すのに必要な値上げ</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{review.neededPct && review.neededPct > 0 ? `約 ${review.neededPct}%` : "なし"}</div>
          <div className="text-xs text-slate-500">売る数が同じとした場合</div>
        </div>
      </div>

      {review.findings.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
          {review.findings.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      )}

      {review.costUps.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <h2 className="border-b px-4 py-2 text-sm font-semibold">上がった費用(1か月あたり)</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs whitespace-nowrap text-slate-500">
                <tr>
                  <th className="px-3 py-2">科目</th>
                  <th className="px-3 py-2 text-right">{basisLabel}</th>
                  <th className="px-3 py-2 text-right">直近3か月</th>
                  <th className="px-3 py-2 text-right">増えた額</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {review.costUps.map((c) => (
                  <tr key={c.code}>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {c.code} {c.name}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatYen(c.base)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatYen(c.recent)}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
                      +{formatYen(c.diff)}
                      {c.pct !== null && <span className="block text-xs text-slate-500">{c.pct}%</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold">値上げした場合(1か月あたり)</h2>
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <label className="flex flex-col text-xs text-slate-500">
            値上げの割合(%)
            <input type="number" min={0.1} max={100} step={0.5} value={raise} onChange={(e) => setRaise(Number(e.target.value))} className="mt-1 w-28 rounded border px-2 py-1 text-right text-sm text-slate-900" />
          </label>
          <label className="flex flex-col text-xs text-slate-500">
            お客さま(売る数)が減る割合(%)
            <input type="number" min={0} max={90} step={1} value={loss} onChange={(e) => setLoss(Number(e.target.value))} className="mt-1 w-28 rounded border px-2 py-1 text-right text-sm text-slate-900" />
          </label>
          {sim && (
            <p className="text-sm text-slate-700">
              利益は月に <span className={`font-semibold tabular-nums ${sim.diff >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{sim.diff >= 0 ? "+" : "−"}{formatYen(Math.abs(sim.diff))}</span>
              {sim.breakEvenLoss !== null && <>(売る数が {sim.breakEvenLoss}% 減るまでは、値上げ前より利益が増えます)</>}
            </p>
          )}
        </div>
        {!valid && <p className="text-sm text-rose-700">値上げは0〜100%、減る割合は0〜90%で入れてください。</p>}
        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs whitespace-nowrap text-slate-500">
                <tr>
                  <th className="px-3 py-2">売る数</th>
                  <th className="px-3 py-2 text-right">売上</th>
                  <th className="px-3 py-2 text-right">費用</th>
                  <th className="px-3 py-2 text-right">利益</th>
                  <th className="px-3 py-2 text-right">いまとの差</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                <tr className="text-slate-500">
                  <td className="px-3 py-2">いまのまま</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatYen(review.monthly.revenue)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatYen(review.monthly.expense)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatYen(review.monthly.revenue - review.monthly.expense)}</td>
                  <td className="px-3 py-2 text-right">-</td>
                </tr>
                {rows.map((r) => (
                  <tr key={r.lossPct}>
                    <td className="px-3 py-2 whitespace-nowrap">{r.lossPct ? `${r.lossPct}% 減る` : "変わらない"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatYen(r.revenue)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatYen(r.expense)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatYen(r.profit)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${r.diff >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                      {r.diff >= 0 ? "+" : "−"}
                      {formatYen(Math.abs(r.diff))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-slate-500">直近3か月の1か月平均をもとに、売上原価は売る数に合わせて減り、ほかの費用は変わらないとして計算しています。</p>
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b px-4 py-2">
          <h2 className="text-sm font-semibold">品目ごとの売値(発行した請求書から)</h2>
          <p className="text-xs text-slate-500">チェックした品目は、お知らせ文に新しい価格と並べて入れます。</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs whitespace-nowrap text-slate-500">
              <tr>
                <th className="px-3 py-2" />
                <th className="px-3 py-2">品目</th>
                <th className="px-3 py-2 text-right">いまの単価</th>
                <th className="px-3 py-2">この値段になってから</th>
                <th className="px-3 py-2 text-right">12か月の売上</th>
                <th className="px-3 py-2 text-right">{raise}% 上げると</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {review.items.map((i) => (
                <tr key={i.label}>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label={`${i.label}をお知らせ文に入れる`}
                      checked={selected.has(i.label)}
                      onChange={(e) => {
                        const next = new Set(selected);
                        if (e.target.checked) next.add(i.label);
                        else next.delete(i.label);
                        setSelected(next);
                      }}
                    />
                  </td>
                  <td className="min-w-[10rem] px-3 py-2">
                    {i.label}
                    {i.customers.length > 0 && <span className="block text-xs text-slate-500">{i.customers.join("・")}</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatYen(i.price)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {i.months >= 12 ? <span className="text-amber-700">{i.months}か月</span> : `${i.months}か月`}
                    {i.changed && <span className="block text-xs text-slate-500">前は {formatYen(i.firstPrice)}</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatYen(i.revenue12)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{valid ? formatYen(newPrice(i.price, raise)) : "-"}</td>
                </tr>
              ))}
              {review.items.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                    直近18か月に発行した請求書がありません。
                    <Link href="/invoices/new" className="ml-1 text-indigo-700 hover:underline">
                      請求書を作る
                    </Link>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold">取引先へのお知らせ文</h2>
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <label className="flex flex-col text-xs text-slate-500">
            改定の時期
            <input type="date" value={effective} onChange={(e) => setEffective(e.target.value)} className="mt-1 rounded border px-2 py-1 text-sm text-slate-900" />
          </label>
          <label className="flex min-w-[16rem] flex-1 flex-col text-xs text-slate-500">
            伝えたいこと(任意)
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="例: 品質は変えません。長年のお付き合いへの感謝も" className="mt-1 rounded border px-2 py-1 text-sm text-slate-900" />
          </label>
          <button onClick={draft} disabled={busy || !valid} className="rounded-md bg-vermilion-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-vermilion-700 disabled:opacity-50">
            {busy ? "作っています…" : ai ? "AIでお知らせ文を作る" : "お知らせ文を作る"}
          </button>
        </div>
        {error && <p className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-800">{error}</p>}
        {letter && (
          <div className="space-y-3">
            {letter.advice && <p className="rounded-lg bg-indigo-50 px-4 py-2 text-sm text-indigo-900">AIの見立て: {letter.advice}</p>}
            <textarea value={letter.letter} onChange={(e) => setLetter({ ...letter, letter: e.target.value })} rows={22} className="w-full rounded border px-3 py-2 font-mono text-sm leading-relaxed" aria-label="お知らせ文" />
            <button
              onClick={async () => {
                await navigator.clipboard.writeText(letter.letter);
                setCopied(true);
              }}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
            >
              {copied ? "コピーしました" : "文をコピー"}
            </button>
            <p className="text-xs text-slate-500">送る前に、内容・金額・時期を必ず確かめてください。値上げは1か月以上前に伝えるのが目安です。</p>
          </div>
        )}
      </section>
    </div>
  );
}

"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatYen } from "@/lib/format";

type Account = { id: string; code: string; name: string; category: string; budget: number | null };

export function BudgetForm({ year, accounts }: { year: number; accounts: Account[] }) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(accounts.map((a) => [a.id, a.budget === null ? "" : String(a.budget)])),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // AIの下書き: 伸び率・来期の予定と、科目ごとの理由
  const [draft, setDraft] = useState({ revenueGrowth: "0", expenseGrowth: "0", plans: "" });
  const [drafting, setDrafting] = useState(false);
  const [reasons, setReasons] = useState<Record<string, { text: string; source: string }>>({});
  const [summary, setSummary] = useState<{ text: string; mode: string; base: string } | null>(null);

  async function makeDraft() {
    setDrafting(true);
    setError(null);
    const res = await fetch("/api/budgets/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fiscalYear: year, revenueGrowth: Number(draft.revenueGrowth) || 0, expenseGrowth: Number(draft.expenseGrowth) || 0, plans: draft.plans }),
    });
    const body = await res.json().catch(() => ({}));
    setDrafting(false);
    if (!res.ok) return setError(body.error || "下書きを作れませんでした");
    const rows = body.rows as { accountId: string; amount: number | null; reason: string; source: string }[];
    setValues((v) => ({ ...v, ...Object.fromEntries(rows.map((r) => [r.accountId, r.amount === null ? "" : String(r.amount)])) }));
    setReasons(Object.fromEntries(rows.filter((r) => r.source !== "skip" || r.reason.includes("くり返す")).map((r) => [r.accountId, { text: r.reason, source: r.source }])));
    setSummary({ text: body.summary, mode: body.mode, base: `${body.basePeriod.from}〜${body.basePeriod.to}` });
  }

  const total = (category: string) => accounts.filter((a) => a.category === category).reduce((s, a) => s + (Number(values[a.id]) || 0), 0);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const res = await fetch("/api/budgets", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fiscalYear: year, budgets: accounts.map((a) => ({ accountId: a.id, amount: values[a.id] === "" ? null : Number(values[a.id]) })) }),
    });
    const body = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) return setError(body.error || "保存に失敗しました");
    router.push(`/monthly?fy=${year}`);
    router.refresh();
  }

  const section = (category: string, title: string) => (
    <>
      <tr>
        <td colSpan={2} className="bg-slate-50/60 px-4 py-1 text-xs font-semibold text-slate-500">
          {title}
        </td>
      </tr>
      {accounts
        .filter((a) => a.category === category)
        .map((a) => (
          <tr key={a.id}>
            <td className="px-4 py-1.5">
              <label htmlFor={`b-${a.id}`}>
                {a.code} {a.name}
              </label>
            </td>
            <td className="px-4 py-1.5 text-right">
              <input
                id={`b-${a.id}`}
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                value={values[a.id]}
                onChange={(e) => setValues((v) => ({ ...v, [a.id]: e.target.value }))}
                placeholder="未設定"
                className="w-36 rounded-md border px-2 py-1 text-right text-sm"
              />
              {reasons[a.id] && <p className={`mt-0.5 max-w-xs text-left text-[11px] leading-snug ${reasons[a.id].source === "ai" ? "text-indigo-700" : "text-slate-500"}`}>{reasons[a.id].text}</p>}
            </td>
          </tr>
        ))}
      <tr className="border-t font-medium">
        <td className="px-4 py-2">{title}の予算合計</td>
        <td className="px-4 py-2 text-right tabular-nums">{formatYen(total(category))}</td>
      </tr>
    </>
  );

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/monthly?fy=${year}`} className="text-sm text-indigo-700 hover:underline">
          ← 月次推移表
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">{year}年度の予算</h1>
        <p className="mt-1 text-sm text-slate-600">勘定科目ごとに1年間の予算(円)を入力します。空欄の科目は予算なしになります。</p>
      </div>
      {error && <div className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</div>}
      <section className="max-w-xl space-y-3 rounded-xl border border-indigo-200 bg-indigo-50/50 p-4 text-sm">
        <h2 className="font-semibold text-indigo-900">AIで下書きを作る</h2>
        <p className="text-slate-600">直近12か月の実績をもとに、科目ごとの年間予算を下の入力欄に入れます。来期の予定を書くと、AIがそれも考えて直します(保存するまでは反映されません)。</p>
        <div className="flex flex-wrap gap-3">
          <label className="text-xs text-slate-600">
            売上の伸び(%)
            <input type="number" step="0.1" value={draft.revenueGrowth} onChange={(e) => setDraft((d) => ({ ...d, revenueGrowth: e.target.value }))} className="mt-0.5 block w-24 rounded-md border bg-white px-2 py-1 text-right text-sm" />
          </label>
          <label className="text-xs text-slate-600">
            費用の伸び(%)
            <input type="number" step="0.1" value={draft.expenseGrowth} onChange={(e) => setDraft((d) => ({ ...d, expenseGrowth: e.target.value }))} className="mt-0.5 block w-24 rounded-md border bg-white px-2 py-1 text-right text-sm" />
          </label>
        </div>
        <label className="block text-xs text-slate-600">
          来期の予定(任意)
          <textarea value={draft.plans} onChange={(e) => setDraft((d) => ({ ...d, plans: e.target.value }))} rows={2} maxLength={1000} placeholder="例: 10月に1名採用(月給25万円)。家賃が月3万円上がる。広告は半分にする。" className="mt-0.5 block w-full rounded-md border bg-white px-2 py-1 text-sm" />
        </label>
        <button type="button" onClick={makeDraft} disabled={drafting} className="rounded-md bg-vermilion-600 px-4 py-2 text-sm font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
          {drafting ? "下書きを作っています..." : "下書きを入れる"}
        </button>
        {summary && (
          <div className="rounded-lg bg-white px-3 py-2 ring-1 ring-indigo-100">
            <p className="text-xs font-medium text-indigo-700">{summary.mode === "claude" ? "AIの下書き" : "実績からの下書き"}(もとにした期間 {summary.base})</p>
            <p className="mt-0.5 text-slate-700">{summary.text}</p>
            <p className="mt-1 text-xs text-slate-500">各科目の下に理由を出しています。確かめて直してから「保存する」を押してください。</p>
          </div>
        )}
      </section>
      <form onSubmit={save} className="max-w-xl space-y-4">
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <tbody className="divide-y">
              {section("REVENUE", "収益")}
              {section("EXPENSE", "費用")}
              <tr className="border-t-2 bg-slate-50 font-semibold">
                <td className="px-4 py-2">予算上の利益</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatYen(total("REVENUE") - total("EXPENSE"))}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="flex justify-end">
          <button type="submit" disabled={saving} className="rounded-md bg-vermilion-600 px-5 py-2 text-sm font-medium text-white shadow-sm hover:bg-vermilion-700 disabled:opacity-50">
            {saving ? "保存中..." : "保存する"}
          </button>
        </div>
      </form>
    </div>
  );
}

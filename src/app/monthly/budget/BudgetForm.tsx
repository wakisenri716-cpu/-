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
          <button type="submit" disabled={saving} className="rounded-md bg-indigo-600 px-5 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50">
            {saving ? "保存中..." : "保存する"}
          </button>
        </div>
      </form>
    </div>
  );
}

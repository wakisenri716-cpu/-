"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Company = { id: string; name: string };

// 開いている会社の名前と、ほかの会社への切り替え
export function CompanySwitcher({ companies, current, compact = false }: { companies: Company[]; current: string; compact?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const name = companies.find((c) => c.id === current)?.name ?? "";
  if (companies.length <= 1) {
    return compact ? null : <div className="truncate px-3 text-xs text-slate-500">{name}</div>;
  }

  async function change(companyId: string) {
    if (companyId === current) return;
    setBusy(true);
    const res = await fetch("/api/companies/switch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ companyId }) });
    if (res.ok) {
      // 会社が変わると表示するデータがすべて変わるので、ダッシュボードから開き直す
      router.push("/");
      router.refresh();
      setBusy(false);
      return;
    }
    setBusy(false);
    alert((await res.json().catch(() => ({}))).error ?? "切り替えられませんでした");
  }

  return (
    <label className={compact ? "block" : "block px-3"}>
      <span className="sr-only">開いている会社</span>
      <select
        value={current}
        disabled={busy}
        onChange={(e) => change(e.target.value)}
        className="w-full truncate rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm font-medium text-slate-800 disabled:opacity-60"
      >
        {companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </label>
  );
}

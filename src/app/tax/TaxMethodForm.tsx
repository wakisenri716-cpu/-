"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Option = { value: string; label: string };

// 管理者が消費税の計算方式を切り替える。保存すると上の納付見込みが選んだ方式に変わる。
export function TaxMethodForm({
  method,
  businessType,
  methods,
  businessTypes,
}: {
  method: string;
  businessType: number;
  methods: Option[];
  businessTypes: Option[];
}) {
  const router = useRouter();
  const [value, setValue] = useState(method);
  const [type, setType] = useState(String(businessType));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/company/tax-method", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method: value, businessType: Number(type) }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setMessage({ ok: false, text: body.error || "保存に失敗しました" });
    setMessage({ ok: true, text: "計算方式を保存しました" });
    router.refresh();
  }

  return (
    <form onSubmit={save} className="flex flex-wrap items-end gap-3 print:hidden">
      <label className="text-xs text-slate-500">
        計算方式
        <select value={value} onChange={(e) => setValue(e.target.value)} className="mt-1 block rounded-md border px-2 py-1.5 text-sm text-slate-900">
          {methods.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
      {value === "SIMPLIFIED" && (
        <label className="min-w-0 text-xs text-slate-500">
          事業区分(簡易課税)
          <select value={type} onChange={(e) => setType(e.target.value)} className="mt-1 block max-w-full rounded-md border px-2 py-1.5 text-sm text-slate-900">
            {businessTypes.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <button type="submit" disabled={busy} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
        保存
      </button>
      {message && <span className={`text-sm ${message.ok ? "text-emerald-700" : "text-rose-700"}`}>{message.text}</span>}
    </form>
  );
}

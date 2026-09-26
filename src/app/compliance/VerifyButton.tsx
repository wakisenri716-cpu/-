"use client";

import { useState } from "react";

type Result = { checked: number; ok: number; problems: { kind: string; id: string; label: string; problem: "mismatch" | "noHash" }[] };

export function VerifyButton() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/compliance/verify", { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(body.error || "チェックできませんでした");
    setResult(body);
  }

  return (
    <div className="space-y-3">
      <button type="button" onClick={run} disabled={busy} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 print:hidden">
        {busy ? "チェック中..." : "いますぐチェックする"}
      </button>
      {error && <p className="text-sm text-rose-700">{error}</p>}
      {result && (
        <div className={`rounded-lg px-4 py-3 text-sm ${result.problems.some((p) => p.problem === "mismatch") ? "bg-rose-50 text-rose-900" : "bg-emerald-50 text-emerald-900"}`}>
          <p className="font-medium">
            {result.checked}件をチェックしました。
            {result.problems.length === 0 ? "すべて登録したときのまま(改ざんなし)です。" : `${result.problems.length}件に問題があります。`}
          </p>
          {result.problems.length > 0 && (
            <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs">
              {result.problems.map((p) => (
                <li key={`${p.kind}-${p.id}`}>
                  {p.kind}: {p.label} — {p.problem === "mismatch" ? "登録したときと中身が違います(書き換えられた可能性があります)" : "登録したときの指紋がありません"}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

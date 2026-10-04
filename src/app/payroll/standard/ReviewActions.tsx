"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Change = { staffId: string; name: string; current: number | null; next: number };
const thousand = (n: number | null) => (n === null ? "未設定" : `${(n / 1000).toLocaleString("ja-JP")}千円`);

export function ReviewActions({ year, changing, applied }: { year: number; changing: Change[]; applied: { by: string; at: string; count: number } | null }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(changing.map((c) => c.staffId)));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function run(method: "POST" | "DELETE") {
    if (method === "DELETE" && !confirm(`${year}年の反映を取り消して、反映前の標準報酬月額に戻しますか?`)) return;
    setBusy(true);
    setMessage(null);
    const res = await fetch(`/api/payroll/standard-review${method === "DELETE" ? `?year=${year}` : ""}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: method === "POST" ? JSON.stringify({ year, staffIds: [...selected] }) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setMessage({ ok: false, text: json.error || "できませんでした" });
    setMessage({ ok: true, text: method === "POST" ? `${json.count}人の標準報酬月額を変えました。9月分の給与から新しい金額で計算されます。` : `${json.count}人を反映前の金額に戻しました。` });
    router.refresh();
  }

  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm print:hidden">
      {message && <div className={`rounded-md px-4 py-2 ${message.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"}`}>{message.text}</div>}
      {applied ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p>
            {applied.at.replaceAll("-", "/")}に{applied.by}さんが反映しました({applied.count}人)。
          </p>
          <button disabled={busy} onClick={() => run("DELETE")} className="rounded-md border border-rose-300 px-4 py-2 font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50">
            反映を取り消す
          </button>
        </div>
      ) : changing.length === 0 ? (
        <p className="text-slate-500">標準報酬月額が変わる人はいません。</p>
      ) : (
        <>
          <h2 className="font-semibold">給与計算の設定に反映する</h2>
          <ul className="space-y-1">
            {changing.map((c) => (
              <li key={c.staffId}>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={selected.has(c.staffId)}
                    onChange={(e) =>
                      setSelected((s) => {
                        const n = new Set(s);
                        if (e.target.checked) n.add(c.staffId);
                        else n.delete(c.staffId);
                        return n;
                      })
                    }
                  />
                  {c.name}: {thousand(c.current)} → <span className="font-medium">{thousand(c.next)}</span>
                </label>
              </li>
            ))}
          </ul>
          <button disabled={busy || selected.size === 0} onClick={() => run("POST")} className="rounded-md bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
            選んだ{selected.size}人の標準報酬月額を変える
          </button>
          <p className="text-xs text-slate-500">8月分までの給与を計上し終えてから反映してください(反映後に計算する給与は新しい金額になります)。</p>
        </>
      )}
    </section>
  );
}

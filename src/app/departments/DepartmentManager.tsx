"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

type Dept = { id: string; name: string; active: boolean };

export function DepartmentManager({ departments }: { departments: Dept[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function call(url: string, method: string, body: object, success: string) {
    setBusy(true);
    setMessage(null);
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setMessage({ ok: false, text: data.error || "処理に失敗しました" });
      return false;
    }
    setMessage({ ok: true, text: success });
    router.refresh();
    return true;
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await call("/api/departments", "POST", { name }, `「${name}」を追加しました`)) setName("");
  }

  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="font-semibold">部門・店舗</h2>
      {message && (
        <div className={`rounded-md px-3 py-2 text-sm ${message.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"}`}>{message.text}</div>
      )}
      <form onSubmit={add} className="flex flex-wrap gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="例: 渋谷店、Web事業部" className="min-w-0 flex-1 rounded-md border px-2 py-1.5 text-sm" aria-label="部門名" />
        <button type="submit" disabled={busy} className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
          追加
        </button>
      </form>
      <ul className="divide-y">
        {departments.map((d) => (
          <li key={d.id} className={`flex flex-wrap items-center justify-between gap-2 py-2 text-sm ${d.active ? "" : "text-slate-400"}`}>
            {editing?.id === d.id ? (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (await call(`/api/departments/${d.id}`, "PATCH", { name: editing.name }, "名前を変更しました")) setEditing(null);
                }}
                className="flex flex-1 items-center gap-2"
              >
                <input value={editing.name} onChange={(e) => setEditing({ id: d.id, name: e.target.value })} autoFocus className="min-w-0 flex-1 rounded-md border px-2 py-1 text-sm text-slate-900" aria-label="部門名" />
                <button type="submit" disabled={busy} className="text-xs font-medium text-indigo-700 hover:underline">
                  保存
                </button>
                <button type="button" onClick={() => setEditing(null)} className="text-xs text-slate-500 hover:underline">
                  やめる
                </button>
              </form>
            ) : (
              <>
                <span>
                  {d.name}
                  {!d.active && <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs">停止中</span>}
                </span>
                <span className="flex gap-3 text-xs">
                  <button onClick={() => setEditing({ id: d.id, name: d.name })} className="text-indigo-700 hover:underline">
                    名前を変更
                  </button>
                  <button
                    onClick={() => call(`/api/departments/${d.id}`, "PATCH", { active: !d.active }, d.active ? `「${d.name}」を停止しました` : `「${d.name}」を再開しました`)}
                    disabled={busy}
                    className="text-slate-600 hover:underline"
                  >
                    {d.active ? "停止" : "再開"}
                  </button>
                </span>
              </>
            )}
          </li>
        ))}
        {departments.length === 0 && <li className="py-3 text-sm text-slate-400">まだ部門はありません。</li>}
      </ul>
      <p className="text-xs text-slate-500">
        仕訳帳・請求書の作成画面で部門を選ぶか、仕訳帳の一覧で後から部門を付けます。CSV取込では「部門」列に部門名を書くと付きます。
      </p>
    </section>
  );
}

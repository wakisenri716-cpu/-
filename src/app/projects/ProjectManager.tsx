"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

type Project = {
  id: string;
  name: string;
  customerName: string | null;
  startDate: string | null;
  endDate: string | null;
  budgetRevenue: number | null;
  budgetCost: number | null;
  notes: string | null;
  active: boolean;
};

const inputClass = "mt-1 w-full rounded-md border px-3 py-2 text-sm";

function Fields({ p }: { p?: Project }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block text-sm">
        <span className="text-slate-600">案件名</span>
        <input name="name" required maxLength={50} defaultValue={p?.name} placeholder="例: A社 Webサイト制作" className={inputClass} />
      </label>
      <label className="block text-sm">
        <span className="text-slate-600">顧客(任意)</span>
        <input name="customerName" maxLength={100} defaultValue={p?.customerName ?? ""} className={inputClass} />
      </label>
      <label className="block text-sm">
        <span className="text-slate-600">開始日(任意)</span>
        <input name="startDate" type="date" defaultValue={p?.startDate ?? ""} className={inputClass} />
      </label>
      <label className="block text-sm">
        <span className="text-slate-600">終了日(任意)</span>
        <input name="endDate" type="date" defaultValue={p?.endDate ?? ""} className={inputClass} />
      </label>
      <label className="block text-sm">
        <span className="text-slate-600">受注額の予算(円・税抜・任意)</span>
        <input name="budgetRevenue" inputMode="numeric" defaultValue={p?.budgetRevenue ?? ""} className={inputClass} />
      </label>
      <label className="block text-sm">
        <span className="text-slate-600">原価の予算(円・税抜・任意)</span>
        <input name="budgetCost" inputMode="numeric" defaultValue={p?.budgetCost ?? ""} className={inputClass} />
      </label>
      <label className="block text-sm sm:col-span-2">
        <span className="text-slate-600">メモ(任意)</span>
        <input name="notes" maxLength={500} defaultValue={p?.notes ?? ""} className={inputClass} />
      </label>
    </div>
  );
}

export function ProjectManager({ projects }: { projects: Project[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Project | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [formKey, setFormKey] = useState(0);

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
    const body = Object.fromEntries(new FormData(event.currentTarget));
    if (await call("/api/projects", "POST", body, `「${body.name}」を登録しました`)) setFormKey((k) => k + 1);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    if (await call(`/api/projects/${editing.id}`, "PATCH", Object.fromEntries(new FormData(event.currentTarget)), "案件を変更しました")) setEditing(null);
  }

  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="font-semibold">案件を登録</h2>
      {message && <div className={`rounded-md px-3 py-2 text-sm ${message.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"}`}>{message.text}</div>}
      <form key={formKey} onSubmit={add} className="space-y-3">
        <Fields />
        <button disabled={busy} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
          登録
        </button>
      </form>

      {projects.length > 0 && (
        <ul className="divide-y border-t text-sm">
          {projects.map((p) => (
            <li key={p.id} className={`flex flex-wrap items-center justify-between gap-2 py-2 ${p.active ? "" : "text-slate-400"}`}>
              <span>
                {p.name}
                {!p.active && <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs">完了</span>}
              </span>
              <span className="flex gap-3 text-xs">
                <button onClick={() => setEditing(p)} className="text-indigo-700 hover:underline">
                  変更
                </button>
                <button
                  onClick={() => call(`/api/projects/${p.id}`, "PATCH", { active: !p.active }, p.active ? `「${p.name}」を完了にしました` : `「${p.name}」を再開しました`)}
                  disabled={busy}
                  className="text-slate-600 hover:underline"
                >
                  {p.active ? "完了にする" : "再開する"}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-slate-500">完了にした案件は、仕訳に新しく付けられなくなります(集計には残ります)。</p>

      {editing && (
        <div className="fixed inset-0 z-20 flex items-end justify-center bg-slate-900/30 p-4 sm:items-center" onClick={() => setEditing(null)}>
          <form onSubmit={save} onClick={(e) => e.stopPropagation()} className="max-h-[90vh] w-full max-w-2xl space-y-3 overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
            <h2 className="font-semibold">案件を変更</h2>
            <Fields p={editing} />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(null)} className="rounded-md border px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
                やめる
              </button>
              <button disabled={busy} className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
                保存
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}

"use client";

import Link from "next/link";
import { useState } from "react";

type Folder = { id: string; label: string };

// 証憑を書類フォルダにコピーする小さなボタン。押すとフォルダを選ぶ欄が出る。
export function SaveToFolder({ kind, id }: { kind: "receipt" | "invoice"; id: string }) {
  const [folders, setFolders] = useState<Folder[] | null>(null);
  const [open, setOpen] = useState(false);
  const [folderId, setFolderId] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string; href?: string } | null>(null);

  async function start() {
    setOpen(true);
    setResult(null);
    if (folders) return;
    const res = await fetch("/api/folders");
    const body = await res.json().catch(() => ({}));
    setFolders(res.ok ? body.allFolders : []);
  }

  async function save() {
    setBusy(true);
    const res = await fetch("/api/files/from-document", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, id, folderId: folderId || null }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setResult({ ok: false, text: body.error || "保存できませんでした" });
    setOpen(false);
    setResult({ ok: true, text: "保存しました", href: folderId ? `/files?folder=${folderId}` : "/files" });
  }

  if (result?.ok) {
    return (
      <Link href={result.href!} className="text-xs text-emerald-700 hover:underline">
        {result.text}(開く)
      </Link>
    );
  }
  if (!open) {
    return (
      <button type="button" onClick={start} className="text-xs text-indigo-700 hover:underline">
        フォルダに保存
      </button>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <select value={folderId} onChange={(e) => setFolderId(e.target.value)} className="max-w-[12rem] rounded border px-1 py-0.5 text-xs" aria-label="保存先のフォルダ">
        <option value="">いちばん上</option>
        {folders?.map((f) => (
          <option key={f.id} value={f.id}>
            {f.label}
          </option>
        ))}
      </select>
      <button type="button" onClick={save} disabled={busy || !folders} className="rounded bg-indigo-600 px-2 py-0.5 text-xs text-white disabled:opacity-50">
        保存
      </button>
      <button type="button" onClick={() => setOpen(false)} className="text-xs text-slate-500 hover:underline">
        やめる
      </button>
      {result && !result.ok && <span className="text-xs text-rose-700">{result.text}</span>}
    </span>
  );
}

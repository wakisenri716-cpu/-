"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ForgetButton({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function forget() {
    if (!window.confirm(`「${label}」について覚えたことを忘れさせます。よろしいですか?`)) return;
    setBusy(true);
    const res = await fetch(`/api/ai-learning/${id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) return window.alert((await res.json().catch(() => ({}))).error || "できませんでした");
    router.refresh();
  }
  return (
    <button onClick={forget} disabled={busy} className="text-xs text-rose-600 hover:underline disabled:opacity-50">
      忘れさせる
    </button>
  );
}

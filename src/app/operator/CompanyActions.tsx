"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// 運営者: 無料期間を延ばす・無料にする/戻す
export function CompanyActions({ id, name, billingFree }: { id: string; name: string; billingFree: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function send(body: object, question: string) {
    if (!confirm(question)) return;
    setBusy(true);
    const res = await fetch(`/api/operator/companies/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) alert(json.error || "変更できませんでした");
    router.refresh();
  }

  return (
    <div className="flex flex-wrap justify-end gap-x-3 gap-y-1 text-xs">
      <button disabled={busy} onClick={() => send({ extendDays: 14 }, `「${name}」の無料期間を14日延ばしますか?`)} className="text-indigo-700 hover:underline disabled:opacity-50">
        +14日
      </button>
      <button disabled={busy} onClick={() => send({ extendDays: 30 }, `「${name}」の無料期間を30日延ばしますか?`)} className="text-indigo-700 hover:underline disabled:opacity-50">
        +30日
      </button>
      <button
        disabled={busy}
        onClick={() => send({ billingFree: !billingFree }, billingFree ? `「${name}」の無料を解除しますか?(契約がなければ無料期間の判定に戻ります)` : `「${name}」をずっと無料にしますか?`)}
        className="text-slate-500 hover:underline disabled:opacity-50"
      >
        {billingFree ? "無料を解除" : "無料にする"}
      </button>
    </div>
  );
}

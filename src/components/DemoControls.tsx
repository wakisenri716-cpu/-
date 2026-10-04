"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// 会社が切り替わるので、ダッシュボードを開き直して全体を読み込み直す
async function call(method: "POST" | "DELETE", router: ReturnType<typeof useRouter>) {
  const res = await fetch("/api/demo", { method });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "できませんでした");
  router.push("/");
  router.refresh();
}

// ダッシュボード: サンプルデータ入りのお試し用の会社で試す
export function TryDemoCard() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 text-sm shadow-sm print:hidden">
      <div>
        <p className="font-semibold text-emerald-900">サンプルデータで操作を試してみませんか?</p>
        <p className="mt-0.5 text-emerald-800">売上・経費・請求書・シフト・在庫などが入った「お試し用の会社」を作ります。あなたの会社のデータには影響しません(料金もかかりません)。</p>
        {error && <p className="mt-1 text-rose-700">{error}</p>}
      </div>
      <button
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError(null);
          call("POST", router).catch((e) => {
            setBusy(false);
            setError(e.message);
          });
        }}
        className="rounded-md bg-emerald-600 px-4 py-2 font-medium whitespace-nowrap text-white hover:bg-emerald-700 disabled:opacity-50"
      >
        {busy ? "準備しています..." : "お試し用の会社を開く"}
      </button>
    </section>
  );
}

// お試し用の会社を開いているときの案内
export function DemoBanner() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 print:hidden">
      <span>これはサンプルデータの入った「お試し用の会社」です。自由に操作してみてください(あなたの会社には影響しません)。</span>
      <span className="flex gap-2">
        <button
          disabled={busy}
          onClick={() => {
            if (!confirm("お試し用の会社をしまって、自分の会社に戻りますか?(あとでダッシュボードから開き直せます)")) return;
            setBusy(true);
            call("DELETE", router).catch(() => setBusy(false));
          }}
          className="rounded-md bg-emerald-600 px-3 py-1.5 font-medium whitespace-nowrap text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          自分の会社に戻る
        </button>
      </span>
    </div>
  );
}

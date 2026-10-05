import Link from "next/link";
import { requireCompanyId } from "@/lib/auth/session";
import { getWatches, type WatchStatus } from "@/lib/aiWatch";
import { CheckNowButton } from "./CheckNowButton";

export const dynamic = "force-dynamic";

const STATUS: Record<WatchStatus, { label: string; badge: string; border: string }> = {
  warn: { label: "要確認", badge: "bg-rose-100 text-rose-700", border: "border-rose-200" },
  info: { label: "参考", badge: "bg-amber-100 text-amber-800", border: "border-amber-200" },
  ok: { label: "問題なし", badge: "bg-emerald-100 text-emerald-800", border: "border-slate-200" },
};

// AIの見張り: いろいろな見守りの結果を1画面で
export default async function AiWatchPage() {
  const companyId = await requireCompanyId();
  const watches = await getWatches(companyId);
  const order: WatchStatus[] = ["warn", "info", "ok"];
  const sorted = [...watches].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
  const warn = watches.filter((w) => w.status === "warn").length;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">AIの見張り</h1>
        <p className="mt-1 text-sm text-slate-600">
          資金繰り・契約の期限・督促・顧客と仕入先の変化・発注書と請求書・いつもと違う動き・二重計上・帳簿の点検を、いつもAIが見張っています。要確認のものは毎朝のブリーフィングにも入り、新しく要確認になったものは毎朝、管理者にメールとスマホアプリで知らせます(「メール設定」で止められます)。
        </p>
        <div className="mt-2">
          <CheckNowButton />
        </div>
      </div>
      <div className={`rounded-xl border p-4 text-sm shadow-sm ${warn ? "border-rose-200 bg-rose-50 text-rose-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
        {warn ? `${watches.length}つの見張りのうち、${warn}つで確かめたいことがあります。` : `${watches.length}つの見張りすべてで、急いで確かめることはありません。`}
      </div>
      <ul className="grid gap-3 md:grid-cols-2">
        {sorted.map((w) => (
          <li key={w.key} className={`flex flex-col rounded-xl border bg-white p-4 shadow-sm ${STATUS[w.status].border}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">{w.label}</h2>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS[w.status].badge}`}>{STATUS[w.status].label}</span>
            </div>
            <p className="mt-1 text-sm text-slate-700">{w.headline}</p>
            {w.items.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-xs text-slate-600">
                {w.items.map((it, i) => (
                  <li key={i} className="pl-3 -indent-3 break-words">
                    ・{it}
                  </li>
                ))}
              </ul>
            )}
            <Link href={w.href} className="mt-auto pt-2 text-sm text-indigo-700 hover:underline">
              開く →
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

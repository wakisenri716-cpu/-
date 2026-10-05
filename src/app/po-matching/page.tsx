import Link from "next/link";
import { requireCompanyId } from "@/lib/auth/session";
import { getPoMatches, type MatchKind } from "@/lib/poMatching";
import { formatYen } from "@/lib/format";
import { MatchActions } from "./MatchActions";

export const dynamic = "force-dynamic";

const KIND: Record<MatchKind, { label: string; className: string }> = {
  DOUBLE: { label: "二重計上の疑い", className: "bg-rose-100 text-rose-700" },
  MISMATCH: { label: "金額が違う", className: "bg-amber-100 text-amber-800" },
  MATCH: { label: "金額が一致", className: "bg-emerald-100 text-emerald-800" },
  NO_PO: { label: "発注書なし", className: "bg-slate-100 text-slate-700" },
};

// 発注書と受け取った請求書の突き合わせ
export default async function PoMatchingPage() {
  const companyId = await requireCompanyId();
  const rows = await getPoMatches(companyId);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">発注書と請求書の突き合わせ</h1>
        <p className="mt-1 text-sm text-slate-600">
          AIで読み取った受け取った請求書(請求書の画面・AI受付箱)を、同じ取引先の発注書と比べます。金額がぴったりの発注書が1つだけなら、取り込んだときに自動で検収済みにします。金額が違うもの・二重計上の疑いがあるもの・発注書のない請求書をここで確かめます(直近180日)。
        </p>
      </div>
      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">確かめる請求書はありません。</div>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.invoice.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${KIND[r.kind].className}`}>{KIND[r.kind].label}</span>
                <span className="font-medium">{r.vendor}</span>
              </div>
              <div className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
                <div className="rounded-lg bg-slate-50 p-2">
                  <div className="text-xs text-slate-500">受け取った請求書</div>
                  <div>
                    {r.invoice.number ?? "(番号なし)"}・{r.invoice.date}
                  </div>
                  <div className="font-semibold tabular-nums">{formatYen(r.invoice.total)}</div>
                  <div className="text-xs text-slate-500 tabular-nums">
                    税抜 {formatYen(r.invoice.subtotal)}・消費税 {formatYen(r.invoice.tax)}
                  </div>
                </div>
                <div className="rounded-lg bg-slate-50 p-2">
                  <div className="text-xs text-slate-500">発注書</div>
                  {r.order ? (
                    <>
                      <Link href={`/purchase-orders/${r.order.id}`} className="text-indigo-700 hover:underline">
                        {r.order.number}
                      </Link>
                      <span>・納期 {r.order.deliveryDate}{r.order.status === "RECEIVED" && "(検収済み)"}</span>
                      <div className="font-semibold tabular-nums">{formatYen(r.order.total)}</div>
                      <div className="text-xs text-slate-500 tabular-nums">
                        税抜 {formatYen(r.order.subtotal)}・消費税 {formatYen(r.order.tax)}
                      </div>
                    </>
                  ) : (
                    <div className="text-slate-500">合う発注書がありません</div>
                  )}
                </div>
              </div>
              <p className={`mt-2 text-sm ${r.kind === "DOUBLE" ? "text-rose-700" : r.kind === "MISMATCH" ? "text-amber-800" : "text-slate-700"}`}>{r.message}</p>
              <div className="mt-2">
                <MatchActions kind={r.kind} orderId={r.order?.id ?? null} invoiceId={r.invoice.id} label={`請求書 ${r.invoice.number ?? ""}`} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

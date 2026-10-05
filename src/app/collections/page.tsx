import Link from "next/link";
import { requireCompanyId } from "@/lib/auth/session";
import { getCollections, STAGE_LABELS, type CollectionRow, type Stage } from "@/lib/collections";
import { formatYen } from "@/lib/format";
import { SendMailButton } from "@/components/SendMailButton";

export const dynamic = "force-dynamic";

const md = (key: string) => `${Number(key.slice(5, 7))}/${Number(key.slice(8))}`;

function habitText(h: CollectionRow["habit"]) {
  if (!h || h.paidCount === 0) return "入金の記録がまだない顧客です";
  if (h.lateCount === 0) return `これまで ${h.paidCount}件 すべて期限どおりに入金(行き違い・手続き漏れかもしれません)`;
  return `これまで ${h.paidCount}件中 ${h.lateCount}件 が遅れて入金(平均 ${h.avgLateDays}日 遅れ)`;
}

// 督促・回収: 支払期限を過ぎた請求書と、それぞれの「次にやること」。督促メールはAIが相手に合わせて書ける。
export default async function CollectionsPage() {
  const companyId = await requireCompanyId();
  const { rows, total } = await getCollections(companyId);
  const counts = rows.reduce((m, r) => m.set(r.stage, (m.get(r.stage) ?? 0) + 1), new Map<Stage, number>());

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">督促・回収</h1>
        <p className="mt-1 text-sm text-slate-600">
          支払期限を過ぎた請求書ごとに、遅れている日数・これまでの督促・その顧客のふだんの払い方から「次にやること」を出します。督促メールの送信画面では、AIが段階と相手に合わせて文面を書き直せます。
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="text-xs text-slate-500">期限を過ぎた未入金</div>
          <div className="mt-1 text-xl font-semibold tabular-nums">{formatYen(total)}</div>
          <div className="text-xs text-slate-500">{rows.length}件</div>
        </div>
        {(["FIRST", "SECOND", "CALL", "LEGAL"] as Stage[]).map((s) => (
          <div key={s} className={`rounded-xl border border-slate-200 bg-white p-3 shadow-sm ${s === "LEGAL" ? "hidden sm:block" : ""}`}>
            <div className="text-xs text-slate-500">次は「{STAGE_LABELS[s].label}」</div>
            <div className="mt-1 text-xl font-semibold tabular-nums">{counts.get(s) ?? 0}件</div>
          </div>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">支払期限を過ぎた未入金の請求書はありません。</div>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => {
            const st = STAGE_LABELS[r.stage];
            return (
              <li key={r.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${st.className}`}>{st.label}</span>
                      <span className="font-medium break-words">{r.customer?.name ?? "(顧客なし)"}</span>
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      <Link href={`/invoices/${r.id}/print`} className="text-indigo-700 hover:underline">
                        {r.invoiceNumber ?? "請求書"}
                      </Link>
                      ・期限 {md(r.dueDate)}(<span className="font-medium text-rose-700">{r.daysOverdue}日</span> 過ぎ)
                      ・督促 {r.reminders}回{r.lastReminded && `(最後 ${md(r.lastReminded)})`}
                      {r.partiallyPaid && "・一部入金あり"}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-semibold tabular-nums">{formatYen(r.remaining)}</div>
                    {r.partiallyPaid && <div className="text-xs text-slate-500">請求 {formatYen(r.total)}</div>}
                  </div>
                </div>
                <p className="mt-2 text-sm">{st.action}</p>
                <p className="text-xs text-slate-500">{habitText(r.habit)}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <SendMailButton kind="reminder" id={r.id} tone="warning" />
                  <Link href={`/invoices/${r.id}/reminder`} className="rounded-md border px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
                    督促状を印刷
                  </Link>
                  {r.customer?.phone && (
                    <a href={`tel:${r.customer.phone.replace(/[^\d+]/g, "")}`} className="rounded-md border px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
                      電話 {r.customer.phone}
                    </a>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

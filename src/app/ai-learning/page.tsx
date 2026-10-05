import Link from "next/link";
import { requireCompanyId } from "@/lib/auth/session";
import { getLearningOverview, LEARN_AFTER } from "@/lib/aiLearning";
import { formatDate, formatPercent } from "@/lib/format";
import { ForgetButton } from "./ForgetButton";

export const dynamic = "force-dynamic";

const KIND: Record<string, string> = { EXPENSE: "経費", INVOICE: "受け取った請求書", BANK: "銀行・カード明細" };

// AIが覚えたこと: 人がAIの勘定科目を直した記録と、そこから覚えたこと
export default async function AiLearningPage() {
  const companyId = await requireCompanyId();
  const o = await getLearningOverview(companyId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">AIが覚えたこと</h1>
        <p className="mt-1 text-sm text-slate-600">
          レビューキューや銀行明細でAIの勘定科目を直すと、AIがそれを記録します。同じ取引先・同じ摘要で続けて{LEARN_AFTER}回同じ科目に直されると覚え、次からはその科目にします(取引先は既定科目に、明細は科目の候補を出すルールにします)。
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="text-xs text-slate-500">AIの読み取りがそのまま正しかった割合(90日)</div>
          <div className="mt-1 text-xl font-semibold tabular-nums">{o.accuracy === null ? "-" : formatPercent(o.accuracy)}</div>
          <div className="text-xs text-slate-500">
            そのまま {o.autoApplied}件・直した {o.corrected}件
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="text-xs text-slate-500">覚えたこと</div>
          <div className="mt-1 text-xl font-semibold tabular-nums">{o.learned.length}件</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="text-xs text-slate-500">人が直した回数(90日)</div>
          <div className="mt-1 text-xl font-semibold tabular-nums">{o.correctionsLast90}回</div>
        </div>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="font-semibold">覚えたこと</h2>
        {o.learned.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">まだ覚えたことはありません。</p>
        ) : (
          <ul className="mt-2 divide-y">
            {o.learned.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className="min-w-0">
                  <span className="mr-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{KIND[l.kind]}</span>
                  <span className="break-all font-medium">{l.kind === "BANK" ? `摘要に「${l.label}」` : l.label}</span>
                  <span className="mx-1 text-slate-400">→</span>
                  <span>{l.account}</span>
                  <span className="block text-xs text-slate-500">
                    {formatDate(l.learnedAt)} に覚えました・{l.learned === "BANK_RULE" ? (
                      <Link href="/bank/rules" className="text-indigo-700 hover:underline">
                        明細のルール{l.hits ? `(${l.hits}回使用)` : ""}
                      </Link>
                    ) : (
                      "取引先の既定科目"
                    )}
                  </span>
                </span>
                <ForgetButton id={l.id} label={l.label} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {o.pending.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="font-semibold">もう少しで覚えること</h2>
          <ul className="mt-2 divide-y">
            {o.pending.map((p, i) => (
              <li key={i} className="py-2 text-sm">
                <span className="mr-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{KIND[p.kind]}</span>
                <span className="break-all">{p.label}</span>
                <span className="mx-1 text-slate-400">→</span>
                {p.account}
                <span className="ml-2 text-xs text-indigo-700">あと{p.remaining}回同じように直すと覚えます</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="font-semibold">最近直したもの</h2>
        {o.recent.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">まだ直した記録はありません。</p>
        ) : (
          <ul className="mt-2 divide-y">
            {o.recent.map((r) => (
              <li key={r.id} className="py-2 text-sm">
                <span className="text-xs text-slate-500">{formatDate(r.createdAt)}</span>
                <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{KIND[r.kind]}</span>
                <span className="ml-2 break-all">{r.label}</span>
                <span className="block text-xs text-slate-600">
                  {r.from} → <span className="font-medium">{r.to}</span>
                  {r.learned && <span className="ml-2 text-indigo-700">(ここで覚えました)</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

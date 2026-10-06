import Link from "next/link";
import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { aiEnabled } from "@/lib/ai/access";
import { hasCondition, KIND_LABELS, looksNatural, parseSearch, parseWithAi, runSearch, type SearchFilters } from "@/lib/globalSearch";
import { formatYen } from "@/lib/format";
import { StatusBadge } from "@/components/StatusBadge";

export const dynamic = "force-dynamic";

// 見積書・発注書は同じ OPEN でも意味が違うので、ここで名前を付ける
const OWN_LABELS: Record<string, Record<string, string>> = {
  quote: { OPEN: "未請求", INVOICED: "請求済み" },
  order: { OPEN: "発注中", RECEIVED: "検収済み" },
};

const EXAMPLES = ["先月のA社の請求書", "10万円以上の経費", "受け取った請求書 今月", "家賃の仕訳", "更新が近い契約", "見積 9月"];

function Chips({ f }: { f: SearchFilters }) {
  const chips = [
    ...f.kinds.map((k) => `種類: ${KIND_LABELS[k]}`),
    ...(f.direction ? [f.direction === "ISSUED" ? "発行した請求書" : "受け取った請求書"] : []),
    ...(f.from || f.to ? [`期間: ${f.from ?? ""}〜${f.to ?? ""}`] : []),
    ...(f.min !== null || f.max !== null ? [`金額: ${f.min !== null ? formatYen(f.min) : ""}〜${f.max !== null ? formatYen(f.max) : ""}`] : []),
    ...f.keywords.map((k) => `「${k}」`),
  ];
  if (!chips.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((c) => (
        <span key={c} className="rounded-full bg-white px-2.5 py-0.5 text-xs text-slate-700 ring-1 ring-slate-200">
          {c}
        </span>
      ))}
    </div>
  );
}

// すべてのデータから探す(請求書・見積書・発注書・仕訳・経費・契約・取引先・書類)
export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string; ai?: string }> }) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const { q: raw, ai } = await searchParams;
  const q = (raw ?? "").trim().slice(0, 200);
  const canAi = await aiEnabled(companyId);

  let filters: SearchFilters | null = null;
  let mode: "claude" | "template" = "template";
  if (q) {
    const rule = parseSearch(q);
    if (canAi && (ai === "1" || looksNatural(q, rule))) ({ filters, mode } = await parseWithAi(companyId, user.id, q, rule));
    else filters = rule;
  }
  const result = filters && hasCondition(filters) ? await runSearch(companyId, filters) : null;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">すべてのデータから探す</h1>
        <p className="mt-1 text-sm text-slate-600">請求書・見積書・発注書・仕訳・経費・契約書・取引先・書類をまとめて探します。「先月のA社の請求書」「10万円以上の経費」のように、ふつうの言葉で書けます。</p>
      </div>

      <form action="/search" className="flex flex-col gap-2 rounded-xl border border-indigo-200 bg-indigo-50/60 p-3 sm:flex-row sm:items-center">
        <input name="q" defaultValue={q} maxLength={200} autoFocus placeholder="例: 先月のA社の請求書" aria-label="探す言葉" className="min-w-0 flex-1 rounded-full border border-indigo-200 bg-white px-4 py-2 text-sm" />
        <div className="flex gap-2">
          <button className="flex-1 rounded-full bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 sm:flex-none">探す</button>
          {canAi && (
            <button name="ai" value="1" className="flex-1 rounded-full border border-indigo-300 bg-white px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-50 sm:flex-none">
              AIに探してもらう
            </button>
          )}
        </div>
      </form>

      {!q && (
        <div className="space-y-2">
          <p className="text-sm text-slate-600">たとえば:</p>
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((e) => (
              <Link key={e} href={`/search?q=${encodeURIComponent(e)}`} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm text-slate-700 hover:border-indigo-300 hover:text-indigo-700">
                {e}
              </Link>
            ))}
          </div>
        </div>
      )}

      {filters && (
        <div className="space-y-2">
          <p className="text-xs text-slate-500">{mode === "claude" ? "AIが読み取った条件" : "読み取った条件"}</p>
          <Chips f={filters} />
        </div>
      )}

      {q && !result && <p className="text-sm text-slate-600">探す言葉を入れてください。</p>}

      {result && (
        <>
          <p className="text-sm text-slate-600">{result.total ? `${result.total}件見つかりました(種類ごとに新しい順で最大20件)` : "見つかりませんでした。言葉を短くするか、期間・金額を外してお試しください。"}</p>
          {result.groups.map((g) => (
            <section key={g.kind} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <h2 className="border-b border-slate-100 bg-slate-50/80 px-4 py-2 text-sm font-semibold">
                {g.label} <span className="font-normal text-slate-500">{g.hits.length}件</span>
              </h2>
              <ul className="divide-y divide-slate-100">
                {g.hits.map((h) => (
                  <li key={`${h.kind}-${h.id}`}>
                    <Link href={h.href} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5 hover:bg-indigo-50/40">
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-slate-900">{h.title}</span>
                        {h.subtitle && <span className="block truncate text-xs text-slate-500">{h.subtitle}</span>}
                      </span>
                      <span className="flex shrink-0 items-center gap-3 text-sm">
                        {h.date && <span className="text-xs text-slate-500 tabular-nums">{h.date}</span>}
                        {h.amount !== null && <span className="tabular-nums">{formatYen(h.amount)}</span>}
                        {h.status && OWN_LABELS[h.kind]?.[h.status] ? (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">{OWN_LABELS[h.kind][h.status]}</span>
                        ) : (
                          h.status && ["invoice", "quote", "order", "journal", "expense"].includes(h.kind) && <StatusBadge status={h.status} />
                        )}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
    </div>
  );
}

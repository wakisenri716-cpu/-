import Link from "next/link";
import { requireCompanyId } from "@/lib/auth/session";
import { getBriefing, getBriefingDates, weekdayOf, type BriefingFacts, type BriefingItem } from "@/lib/assistant/briefing";
import { formatYen } from "@/lib/format";
import { jstDateKey } from "@/lib/jst";
import { RegenerateButton } from "./RegenerateButton";

export const dynamic = "force-dynamic";

const md = (key: string) => `${Number(key.slice(5, 7))}月${Number(key.slice(8))}日`;

function DueList({ title, rows, empty }: { title: string; rows: BriefingFacts["thisWeek"]["incoming"]; empty: string }) {
  return (
    <div className="min-w-0">
      <h3 className="text-sm font-semibold">{title}</h3>
      {rows.length === 0 ? (
        <p className="mt-1 text-sm text-slate-500">{empty}</p>
      ) : (
        <ul className="mt-1 divide-y text-sm">
          {rows.map((r, i) => (
            <li key={i} className="flex items-baseline justify-between gap-3 py-1.5">
              <span className="min-w-0">
                <span className="mr-2 text-xs text-slate-500 tabular-nums">{md(r.dueDate)}</span>
                <span className="break-words">{r.party}</span>
              </span>
              <span className="shrink-0 font-medium tabular-nums">{formatYen(r.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default async function BriefingPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const companyId = await requireCompanyId();
  const today = jstDateKey(new Date());
  const q = (await searchParams).date;
  const date = q && /^\d{4}-\d{2}-\d{2}$/.test(q) && q <= today ? q : today;
  const [briefing, history] = await Promise.all([getBriefing(companyId, date), getBriefingDates(companyId)]);
  const items = (briefing?.items ?? []) as BriefingItem[];
  const notes = (briefing?.notes ?? []) as string[];
  const facts = briefing?.facts as BriefingFacts | undefined;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">AIの朝のブリーフィング</h1>
          <p className="mt-1 text-sm text-slate-600">
            今日の「やること」、昨日のお金の動き、今週の入金・支払の予定をもとに、AIが今日まずやることを優先順に選びます。毎朝、ダッシュボードを開いたときに作られます(「メール設定」で毎朝のメールにも入れられます)。
          </p>
        </div>
        {date === today && <RegenerateButton exists={!!briefing} />}
      </div>

      <div className="text-sm font-medium">
        {md(date)}({weekdayOf(date)})
        {date !== today && (
          <Link href="/briefing" className="ml-3 font-normal text-indigo-700 hover:underline">
            今日を見る
          </Link>
        )}
      </div>

      {!briefing ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
          {date === today ? "今日のブリーフィングはまだありません。「今日のまとめを作る」を押してください。" : "この日のブリーフィングはありません。"}
        </div>
      ) : (
        <>
          <section className="rounded-xl border border-indigo-200 bg-white p-4 shadow-sm">
            <p className="text-base font-medium text-indigo-950">{briefing.headline}</p>
            {items.length > 0 && (
              <ol className="mt-4 space-y-3">
                {items.map((item, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-sm font-semibold text-white">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                        <span className="font-medium">{item.title}</span>
                        <Link href={item.href} className="text-sm text-indigo-700 hover:underline">
                          開く →
                        </Link>
                      </div>
                      <p className="text-sm text-slate-600">{item.reason}</p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
            {notes.length > 0 && (
              <div className="mt-4 rounded-lg bg-slate-50 p-3">
                <h2 className="text-xs font-semibold text-slate-500">知っておくとよいこと</h2>
                <ul className="mt-1 space-y-1 text-sm">
                  {notes.map((n, i) => (
                    <li key={i} className="pl-4 -indent-4">
                      ・{n}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="mt-3 text-xs text-slate-400">
              {briefing.mode === "claude" ? "AIが選びました" : "決まったルールで並べました(AIのキーが設定されていないため)"}・{briefing.createdAt.toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" })} 作成
            </p>
          </section>

          {facts && (
            <section className="grid gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-3">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold">昨日({md(facts.yesterday.date)})の動き</h3>
                <dl className="mt-1 space-y-1 text-sm">
                  {[
                    ["入金", facts.yesterday.deposits],
                    ["出金", facts.yesterday.withdrawals],
                    ["発行した請求書", facts.yesterday.issuedInvoices],
                    ["受け取った請求書", facts.yesterday.receivedInvoices],
                  ].map(([label, v]) => {
                    const x = v as { count: number; total: number };
                    return (
                      <div key={label as string} className="flex justify-between gap-3">
                        <dt className="text-slate-600">{label as string}</dt>
                        <dd className="tabular-nums">
                          {x.count}件 {formatYen(x.total)}
                        </dd>
                      </div>
                    );
                  })}
                  <div className="flex justify-between gap-3 border-t pt-1">
                    <dt className="text-slate-600">現預金の残高</dt>
                    <dd className="font-medium tabular-nums">{formatYen(facts.cash)}</dd>
                  </div>
                </dl>
              </div>
              <DueList title="今週の入金予定" rows={facts.thisWeek.incoming} empty="7日以内に期日の来る入金はありません。" />
              <DueList title="今週の支払予定" rows={facts.thisWeek.outgoing} empty="7日以内に期日の来る支払はありません。" />
            </section>
          )}
        </>
      )}

      {history.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-slate-600">これまでのブリーフィング</h2>
          <div className="mt-2 flex flex-wrap gap-2">
            {history.map((h) => (
              <Link
                key={h.date}
                href={`/briefing?date=${h.date}`}
                className={`rounded-full border px-3 py-1 text-sm ${h.date === date ? "border-indigo-600 bg-indigo-50 text-indigo-800" : "border-slate-200 bg-white hover:bg-slate-50"}`}
              >
                {md(h.date)}({weekdayOf(h.date)})
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

import Link from "next/link";
import { requireCompanyId } from "@/lib/auth/session";
import { getCalendar, resolveMonth, shiftMonth, type CalendarEvent, type CalendarEventKind } from "@/lib/calendar";
import { formatYen } from "@/lib/format";
import { jstDateKey } from "@/lib/jst";
import { PrintButton } from "@/components/PrintButton";

export const dynamic = "force-dynamic";

// 種類は色だけでなく「入金」「支払」などの文字でも区別する
const KIND: Record<CalendarEventKind, { tag: string; className: string }> = {
  receive: { tag: "入金", className: "bg-emerald-50 text-emerald-900 ring-emerald-200" },
  pay: { tag: "支払", className: "bg-rose-50 text-rose-900 ring-rose-200" },
  recurring: { tag: "定期", className: "bg-slate-100 text-slate-700 ring-slate-200" },
  recurringInvoice: { tag: "請求", className: "bg-indigo-50 text-indigo-900 ring-indigo-200" },
  file: { tag: "期限", className: "bg-amber-50 text-amber-900 ring-amber-200" },
};

const WEEK = ["日", "月", "火", "水", "木", "金", "土"];

function Chip({ e }: { e: CalendarEvent }) {
  const k = KIND[e.kind];
  return (
    <Link href={e.href} className={`block truncate rounded px-1.5 py-0.5 text-[11px] ring-1 ${k.className} ${e.overdue ? "font-semibold" : ""}`} title={`${k.tag} ${e.label}${e.amount !== null ? ` ${formatYen(e.amount)}` : ""}`}>
      {k.tag}
      {e.overdue && "(期限切れ)"} {e.label}
    </Link>
  );
}

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const companyId = await requireCompanyId();
  const today = jstDateKey(new Date());
  const month = resolveMonth((await searchParams).month, today);
  const { events, totals } = await getCalendar(companyId, month, today);
  const [y, m] = month.split("-").map(Number);

  // 日曜始まりの週ごとのマス(前後の月の日は空欄)
  const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (string | null)[] = [...Array(firstDow).fill(null), ...Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`)];
  while (cells.length % 7) cells.push(null);
  const byDate = new Map<string, CalendarEvent[]>();
  for (const e of events) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">入金・支払カレンダー</h1>
          <p className="mt-1 text-sm text-slate-600">請求書の入金予定・支払予定、定期取引・定期請求の日、書類の期限を月ごとに表示します。</p>
        </div>
        <PrintButton variant="outline" />
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link href={`/calendar?month=${shiftMonth(month, -1)}`} className="rounded-md border px-2 py-1 hover:bg-slate-50 print:hidden" aria-label="前の月">
          ◀
        </Link>
        <span className="text-lg font-semibold">
          {y}年{m}月
        </span>
        <Link href={`/calendar?month=${shiftMonth(month, 1)}`} className="rounded-md border px-2 py-1 hover:bg-slate-50 print:hidden" aria-label="次の月">
          ▶
        </Link>
        {month !== today.slice(0, 7) && (
          <Link href="/calendar" className="text-indigo-700 hover:underline print:hidden">
            今月
          </Link>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:max-w-md">
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="text-xs text-slate-500">入金予定(未回収)</div>
          <div className="mt-0.5 text-lg font-semibold tabular-nums">{formatYen(totals.receive)}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="text-xs text-slate-500">支払予定(未払い)</div>
          <div className="mt-0.5 text-lg font-semibold tabular-nums">{formatYen(totals.pay)}</div>
        </div>
      </div>

      <div className="hidden overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm sm:block">
        <div className="grid grid-cols-7 border-b bg-slate-50 text-center text-xs text-slate-500">
          {WEEK.map((w, i) => (
            <div key={w} className={`py-1.5 ${i === 0 ? "text-rose-600" : i === 6 ? "text-sky-700" : ""}`}>
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((date, i) => {
            const list = date ? (byDate.get(date) ?? []) : [];
            return (
              <div key={date ?? `blank-${i}`} className={`min-h-24 min-w-0 space-y-1 border-r border-b p-1.5 ${i % 7 === 6 ? "border-r-0" : ""} ${date === today ? "bg-indigo-50/60" : ""} ${!date ? "bg-slate-50/60" : ""}`}>
                {date && (
                  <div className={`text-xs ${date === today ? "font-bold text-indigo-700" : i % 7 === 0 ? "text-rose-600" : i % 7 === 6 ? "text-sky-700" : "text-slate-500"}`}>{Number(date.slice(8))}</div>
                )}
                {list.slice(0, 3).map((e, j) => (
                  <Chip key={j} e={e} />
                ))}
                {list.length > 3 && <div className="text-[11px] text-slate-500">ほか{list.length - 3}件</div>}
              </div>
            );
          })}
        </div>
      </div>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <h2 className="border-b px-4 py-2 text-sm font-semibold">この月の予定({events.length}件)</h2>
        {events.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-slate-400">この月の予定はありません。</p>
        ) : (
          <ul className="divide-y text-sm">
            {events.map((e, i) => {
              const k = KIND[e.kind];
              return (
                <li key={i} className="flex items-start gap-3 px-4 py-2">
                  <span className="w-14 shrink-0 text-xs whitespace-nowrap text-slate-500 tabular-nums">
                    {Number(e.date.slice(5, 7))}/{Number(e.date.slice(8))}({WEEK[new Date(`${e.date}T00:00:00Z`).getUTCDay()]})
                  </span>
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] ring-1 ${k.className}`}>{k.tag}</span>
                  <Link href={e.href} className="min-w-0 flex-1 break-words hover:underline">
                    {e.label}
                    {e.overdue && <span className="ml-1 text-xs font-semibold text-rose-700">期限切れ</span>}
                  </Link>
                  {e.amount !== null && <span className="shrink-0 tabular-nums">{formatYen(e.amount)}</span>}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <p className="text-xs text-slate-500">
        入金・支払は、まだ全額の記録がない請求書の残りの金額です(今月の画面では、期日を過ぎたものを今日の欄に出します)。定期取引・定期請求は登録内容からの予定です。
      </p>
    </div>
  );
}

import Link from "next/link";
import { requireCompanyId } from "@/lib/auth/session";
import { listThreads } from "@/lib/journalComments";
import { formatYen } from "@/lib/format";

export const dynamic = "force-dynamic";

const time = (d: Date) => new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(d);

// 税理士とのやりとり: コメントのある仕訳の一覧(未解決 / すべて)
export default async function JournalCommentsPage({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const companyId = await requireCompanyId();
  const all = (await searchParams).all === "1";
  const threads = await listThreads(companyId, { open: !all });
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">税理士とのやりとり</h1>
        <p className="mt-1 text-sm text-slate-600">
          仕訳へのコメント(税理士からの質問と回答)をまとめて見られます。税理士は「ユーザー管理」で権限「税理士(閲覧のみ)」として招待すると、帳簿を見て仕訳にコメントできます(データの変更はできません)。
        </p>
      </div>
      <div className="flex gap-2 text-sm">
        <Link href="/journal-comments" className={`rounded-full px-3 py-1 ${!all ? "bg-indigo-600 text-white" : "border border-slate-300 bg-white text-slate-700"}`}>
          未解決
        </Link>
        <Link href="/journal-comments?all=1" className={`rounded-full px-3 py-1 ${all ? "bg-indigo-600 text-white" : "border border-slate-300 bg-white text-slate-700"}`}>
          すべて
        </Link>
      </div>
      {threads.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">{all ? "まだコメントはありません。" : "未解決の質問はありません。"}</p>
      ) : (
        <ul className="space-y-3">
          {threads.map((t) => (
            <li key={t.entryId} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Link href={`/journal?q=${encodeURIComponent(t.description)}`} className="font-medium text-slate-900 hover:text-indigo-700 hover:underline">
                  {t.date} {t.description}
                </Link>
                <span className="text-sm tabular-nums text-slate-700">{formatYen(t.amount)}</span>
              </div>
              <p className="text-xs text-slate-500">
                借方 {t.debit} / 貸方 {t.credit}
                {t.open ? <span className="ml-2 rounded-full bg-sky-100 px-2 py-0.5 text-sky-800">未解決</span> : <span className="ml-2 text-emerald-700">✓ 解決済み</span>}
              </p>
              <ul className="mt-2 space-y-1.5">
                {t.comments.slice(-3).map((c) => (
                  <li key={c.id} className={`rounded-lg px-3 py-1.5 text-sm ${c.role === "ADVISOR" ? "bg-sky-50" : "ml-6 bg-slate-50"}`}>
                    <span className="text-xs text-slate-500">
                      {c.roleLabel} {c.userName} ・ {time(c.createdAt)}
                    </span>
                    <p className="whitespace-pre-wrap text-slate-800">{c.body}</p>
                  </li>
                ))}
              </ul>
              {t.comments.length > 3 && <p className="mt-1 text-xs text-slate-500">ほか{t.comments.length - 3}件(仕訳帳の「コメント」で全部見られます)</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

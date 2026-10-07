import Link from "next/link";
import { requireCompanyId } from "@/lib/auth/session";
import { listMinutes } from "@/lib/minutes";

export const dynamic = "force-dynamic";

export default async function MinutesPage() {
  const companyId = await requireCompanyId();
  const rows = await listMinutes(companyId);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">議事録</h1>
          <p className="mt-1 text-sm text-slate-600">会議のメモを貼ると、議題・話し合ったこと・決まったこと・やること(担当・期限)に整えます(AIが使えるときは AI で)。保存した議事録は印刷でき、社内のお知らせにも載せられます。</p>
        </div>
        <Link href="/minutes/new" className="rounded-md bg-vermilion-600 px-4 py-2 text-sm font-medium text-white hover:bg-vermilion-700">
          新しい議事録
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-600">まだ議事録はありません。「新しい議事録」から、会議のメモを貼ってみてください。</p>
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          {rows.map((m) => {
            const open = m.content.actions.length;
            return (
              <li key={m.id}>
                <Link href={`/minutes/${m.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-slate-50">
                  <span className="w-24 shrink-0 text-sm text-slate-500 tabular-nums">{m.heldOn.replaceAll("-", "/")}</span>
                  <span className="min-w-0 flex-1 font-medium">{m.title}</span>
                  <span className="text-xs text-slate-500">
                    決定 {m.content.decisions.length}件 ・ やること {open}件{m.attendees.length ? ` ・ 出席 ${m.attendees.length}人` : ""}
                  </span>
                  {m.announcementId && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">お知らせ済み</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

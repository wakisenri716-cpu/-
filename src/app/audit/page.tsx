import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { listAuditLogs } from "@/lib/audit";
import { CsvDownloadLink } from "@/components/CsvDownloadLink";

export const dynamic = "force-dynamic";

const TIME = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ before?: string; action?: string }> }) {
  const user = await requireUser();
  if (user.role !== "ADMIN") {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">操作ログ</h1>
        <p className="text-sm text-slate-600">この画面は管理者だけが使えます。</p>
      </div>
    );
  }
  const { before, action } = await searchParams;
  const { logs, hasMore, actions } = await listAuditLogs(user.companyId, { before, action });
  const q = (extra: Record<string, string>) => new URLSearchParams({ ...(action ? { action } : {}), ...extra }).toString();

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">操作ログ</h1>
          <p className="mt-1 text-sm text-slate-600">誰が・いつ・何をしたかの記録です(ログイン、仕訳の入力・取消、請求書の作成・取消、ユーザーの変更など)。</p>
        </div>
        <CsvDownloadLink href={`/api/audit/export?${q({})}`} />
      </div>

      <form method="get" className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-slate-500">
          操作で絞り込む
          <select name="action" defaultValue={action ?? ""} className="mt-1 block rounded-md border px-2 py-1.5 text-sm text-slate-900">
            <option value="">すべて</option>
            {actions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="rounded-md border px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
          表示
        </button>
      </form>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs whitespace-nowrap text-slate-500">
              <tr>
                <th className="px-4 py-2">日時</th>
                <th className="px-4 py-2">ユーザー</th>
                <th className="px-4 py-2">操作</th>
                <th className="px-4 py-2">内容</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {logs.map((l) => (
                <tr key={l.id}>
                  <td className="px-4 py-2 whitespace-nowrap tabular-nums">{TIME.format(l.createdAt)}</td>
                  <td className="px-4 py-2 whitespace-nowrap">{l.userName}</td>
                  <td className="px-4 py-2 whitespace-nowrap">{l.action}</td>
                  <td className="min-w-[12rem] px-4 py-2 text-slate-600">{l.detail ?? ""}</td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-slate-400">
                    まだ記録はありません。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {hasMore && (
        <Link href={`/audit?${q({ before: logs[logs.length - 1].createdAt.toISOString() })}`} className="inline-block text-sm text-indigo-700 hover:underline">
          もっと古い記録を見る →
        </Link>
      )}
    </div>
  );
}

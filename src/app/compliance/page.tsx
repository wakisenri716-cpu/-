import Link from "next/link";
import { requireCompanyId } from "@/lib/auth/session";
import { historyStats, listRecordHistory, TABLE_LABELS } from "@/lib/compliance";
import { PrintButton } from "@/components/PrintButton";
import { VerifyButton } from "./VerifyButton";

export const dynamic = "force-dynamic";

const JST = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });

const ACTION_CLASS: Record<string, string> = {
  INSERT: "bg-slate-100 text-slate-700",
  UPDATE: "bg-amber-100 text-amber-900",
  DELETE: "bg-rose-100 text-rose-800",
};

export default async function CompliancePage({ searchParams }: { searchParams: Promise<{ all?: string; table?: string }> }) {
  const companyId = await requireCompanyId();
  const q = await searchParams;
  const changesOnly = q.all !== "1";
  const [rows, stats] = await Promise.all([listRecordHistory(companyId, { changesOnly, table: q.table }), historyStats(companyId)]);
  const link = (patch: Record<string, string | undefined>) => {
    const params = new URLSearchParams(Object.entries({ all: q.all, table: q.table, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `/compliance${params.size ? `?${params}` : ""}`;
  };
  const chip = (active: boolean) => `rounded-full border px-3 py-1 text-xs whitespace-nowrap ${active ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">電子帳簿保存法の対応</h1>
          <p className="mt-1 text-sm text-slate-600">
            メールやアップロードで受け取った請求書・領収書(電子取引のデータ)は、電子のまま保存し、「改ざんされていないこと(真実性)」と「すぐ探して見られること(可視性)」を満たす必要があります。
          </p>
        </div>
        <PrintButton variant="outline" />
      </div>

      <section className="grid gap-3 sm:grid-cols-2">
        {[
          { title: "訂正・削除の履歴", state: "自動で記録中", body: "仕訳・レシート・請求書・入金・書類フォルダのファイルが登録・訂正・削除されるたびに、変更前と変更後を自動で記録します。この履歴は誰も書き換え・削除できません。", ok: true },
          { title: "改ざんチェック", state: "登録時の指紋で確認", body: "証憑のファイルを登録したときに指紋(SHA-256)を記録し、あとで中身が変わっていないかを確かめられます。", ok: true },
          { title: "検索(可視性)", state: "対応済み", body: "取引日・金額・取引先を範囲や組み合わせで検索できます。", ok: true, href: "/documents", hrefLabel: "証憑の検索を開く" },
          { title: "事務処理規程", state: "備え付けが必要", body: "訂正・削除のルールを社内で決めた規程を備え付けておくと、より確実です。ひな形に会社名などを入れて印刷できます。", ok: false, href: "/compliance/rules", hrefLabel: "ひな形を作る" },
        ].map((c) => (
          <div key={c.title} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-medium">{c.title}</h2>
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${c.ok ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
                <span aria-hidden>{c.ok ? "✓" : "!"}</span>
                {c.state}
              </span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-slate-600">{c.body}</p>
            {c.href && (
              <Link href={c.href} className="mt-2 inline-block text-xs text-indigo-700 hover:underline print:hidden">
                {c.hrefLabel} →
              </Link>
            )}
          </div>
        ))}
      </section>

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div>
          <h2 className="font-semibold">証憑の改ざんチェック</h2>
          <p className="mt-1 text-xs text-slate-500">経費のレシート画像・受け取った請求書のファイル・書類フォルダのファイルを、登録したときの指紋と比べます。税務調査の前や、月に1回の確認におすすめです。</p>
        </div>
        <VerifyButton />
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="space-y-2 border-b px-4 py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-semibold">訂正・削除の履歴</h2>
            <span className="text-xs text-slate-500">
              記録 {stats.total.toLocaleString("ja-JP")}件(うち訂正・削除 {stats.changes.toLocaleString("ja-JP")}件){stats.since && `・${JST.format(stats.since).split(" ")[0]} から記録`}
            </span>
          </div>
          <div className="flex flex-wrap gap-2 print:hidden">
            <Link href={link({ all: undefined })} className={chip(changesOnly)}>
              訂正・削除だけ
            </Link>
            <Link href={link({ all: "1" })} className={chip(!changesOnly)}>
              登録も含めてすべて
            </Link>
            <span className="mx-1 border-l" />
            <Link href={link({ table: undefined })} className={chip(!q.table)}>
              すべての種類
            </Link>
            {Object.entries(TABLE_LABELS).map(([key, label]) => (
              <Link key={key} href={link({ table: key })} className={chip(q.table === key)}>
                {label}
              </Link>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs whitespace-nowrap text-slate-500">
              <tr>
                <th className="px-4 py-2">日時</th>
                <th className="px-4 py-2">操作</th>
                <th className="px-4 py-2">種類</th>
                <th className="px-4 py-2">内容</th>
                <th className="px-4 py-2">変更点</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="px-4 py-2 text-xs whitespace-nowrap text-slate-600 tabular-nums">{JST.format(r.changedAt)}</td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${ACTION_CLASS[r.rawAction] ?? ""}`}>{r.action}</span>
                  </td>
                  <td className="px-4 py-2 text-xs whitespace-nowrap">{r.table}</td>
                  <td className="min-w-[12rem] px-4 py-2 text-xs">{r.summary}</td>
                  <td className="min-w-[14rem] px-4 py-2 text-xs">
                    {r.changes.length > 0 ? (
                      <ul className="space-y-0.5">
                        {r.changes.slice(0, 6).map((c) => (
                          <li key={c.field}>
                            <span className="text-slate-500">{c.field}:</span> <span className="line-through decoration-slate-400">{c.before}</span> → <span className="font-medium">{c.after}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-slate-400">-</span>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                    {changesOnly ? "まだ訂正・削除はありません。" : "まだ記録はありません。"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="border-t px-4 py-2 text-xs text-slate-500">新しい順に最大200件を表示しています。誰が操作したかは「操作ログ」で同じ日時を確認できます。</p>
      </section>
    </div>
  );
}

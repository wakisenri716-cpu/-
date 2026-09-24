import { requireUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const CONTENTS = [
  "仕訳帳(「仕訳のCSV取込」と同じ形式)",
  "勘定科目・取引先・顧客",
  "請求書・見積書(明細・入金の状況つき)",
  "経費精算・立替経費の精算",
  "固定資産・在庫・在庫の動き",
  "スタッフ・シフト・勤怠(打刻)",
  "銀行明細・定期取引・予算・操作ログ",
];

export default async function BackupPage() {
  const user = await requireUser();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">データのバックアップ</h1>
        <p className="mt-1 text-sm text-slate-600">
          この会社のデータをすべて、Excelで開けるCSVファイルにしてZIPでまとめてダウンロードします。月に1回など、定期的に手元に保存しておくと安心です。
        </p>
      </div>

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="font-semibold">含まれるもの</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
          {CONTENTS.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <p className="text-xs text-slate-500">領収書・請求書の画像は含まれません(「証憑の検索」から1件ずつ表示・保存できます)。</p>
        {user.role === "ADMIN" ? (
          <a href="/api/backup" className="inline-flex rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700">
            ZIPでダウンロード
          </a>
        ) : (
          <p className="text-sm text-slate-500">バックアップのダウンロードは管理者だけができます。</p>
        )}
      </section>
    </div>
  );
}

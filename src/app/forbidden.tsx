import Link from "next/link";

// 権限のない操作(税理士・閲覧専用の人がデータを変えようとしたときなど)
export default function Forbidden() {
  return (
    <div className="mx-auto max-w-lg space-y-3 py-16 text-center">
      <h1 className="text-xl font-semibold">この操作はできません</h1>
      <p className="text-sm text-slate-600">閲覧専用のアカウントでは、データを変えることはできません。仕訳へのコメントで、会社の方に依頼してください。</p>
      <Link href="/" className="inline-block text-sm text-indigo-700 hover:underline">
        ダッシュボードへ戻る
      </Link>
    </div>
  );
}

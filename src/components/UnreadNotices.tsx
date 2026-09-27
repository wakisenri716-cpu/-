import Link from "next/link";

// まだ読んでいない社内のお知らせ(画面の上に出す)
export function UnreadNotices({ count, latest }: { count: number; latest: { id: string; title: string }[] }) {
  if (count === 0) return null;
  return (
    <Link href="/notices" className="block rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-900 hover:bg-indigo-100">
      <span className="font-semibold">まだ読んでいないお知らせが{count}件あります</span>
      <span className="mt-0.5 block truncate text-xs text-indigo-800">
        {latest.map((n) => n.title).join(" / ")}
        {count > latest.length && " ほか"}
      </span>
    </Link>
  );
}

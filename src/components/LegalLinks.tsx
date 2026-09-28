import Link from "next/link";

// 利用規約・プライバシーポリシー・使い方ガイドへのリンク(ログイン画面などの下に置く)
export function LegalLinks() {
  return (
    <nav className="mt-8 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-slate-500 print:hidden" aria-label="規約とガイド">
      <Link href="/terms" className="hover:underline">
        利用規約
      </Link>
      <Link href="/privacy" className="hover:underline">
        プライバシーポリシー
      </Link>
      <Link href="/guide" className="hover:underline">
        使い方ガイド
      </Link>
    </nav>
  );
}

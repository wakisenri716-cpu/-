"use client";

// 帳票ページ右上の操作。印刷ボタンをつけると、ブラウザの印刷(PDF保存)で帳票だけを出力できる。
// 画面のボタン類は印刷には出さない。
export function CsvDownloadLink({ href, print = false }: { href: string; print?: boolean }) {
  return (
    <div className="flex shrink-0 gap-2 self-start print:hidden">
      {print && (
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium whitespace-nowrap text-slate-700 hover:bg-slate-50"
        >
          印刷・PDF
        </button>
      )}
      <a
        href={href}
        className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium whitespace-nowrap text-slate-700 hover:bg-slate-50"
      >
        CSVダウンロード
      </a>
    </div>
  );
}

export function CsvDownloadLink({ href }: { href: string }) {
  return (
    <a
      href={href}
      className="self-start rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium whitespace-nowrap text-slate-700 hover:bg-slate-50"
    >
      CSVダウンロード
    </a>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCompanyId } from "@/lib/auth/session";
import { formatBytes, getFileMeta } from "@/lib/files";
import { FileViewerActions } from "./FileViewerActions";

export const dynamic = "force-dynamic";

export default async function FileViewPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ print?: string }> }) {
  const companyId = await requireCompanyId();
  const { id } = await params;
  const { print } = await searchParams;
  const file = await getFileMeta(companyId, id);
  if (!file) notFound();
  const src = `/api/files/${file.id}`;
  const back = file.folderId ? `/files?folder=${file.folderId}` : "/files";
  const created = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", dateStyle: "medium", timeStyle: "short" }).format(file.createdAt);

  return (
    <div className="space-y-4">
      <div className="space-y-3 print:hidden">
        <nav className="flex flex-wrap items-center gap-1 text-sm">
          <Link href="/files" className="text-indigo-700 hover:underline">
            書類フォルダ
          </Link>
          {file.path.map((p) => (
            <span key={p.id} className="flex items-center gap-1">
              <span className="text-slate-400">/</span>
              <Link href={`/files?folder=${p.id}`} className="text-indigo-700 hover:underline">
                {p.name}
              </Link>
            </span>
          ))}
        </nav>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold break-all">{file.name}</h1>
            <p className="mt-1 text-xs text-slate-500">
              {formatBytes(file.size)}・{created} に {file.uploadedByName} さんが保存
            </p>
            {file.memo && <p className="mt-1 text-sm text-slate-700">メモ: {file.memo}</p>}
            {file.expiresOn && <p className="mt-1 text-sm text-slate-700">期限: {file.expiresOn.toISOString().slice(0, 10).replaceAll("-", "/")}</p>}
          </div>
          <FileViewerActions
            id={file.id}
            name={file.name}
            memo={file.memo ?? ""}
            expiresOn={file.expiresOn ? file.expiresOn.toISOString().slice(0, 10) : ""}
            viewable={file.viewable}
            src={src}
            back={back}
            autoPrint={print === "1"}
          />
        </div>
      </div>

      {file.viewable === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img id="file-preview" src={src} alt={file.name} className="mx-auto block max-h-[80vh] max-w-full rounded-lg border border-slate-200 bg-white print:max-h-none print:border-0" />
      ) : file.viewable === "pdf" ? (
        <iframe id="file-preview" src={src} title={file.name} className="h-[80vh] w-full rounded-lg border border-slate-200 bg-white" />
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">
          この種類のファイルは画面に表示できません。「ダウンロード」で保存して、Excel・Word などのアプリで開いてください(印刷もそのアプリからできます)。
        </div>
      )}
    </div>
  );
}

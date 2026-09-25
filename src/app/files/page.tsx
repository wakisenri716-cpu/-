import { requireCompanyId } from "@/lib/auth/session";
import { FileManager } from "./FileManager";

export const dynamic = "force-dynamic";

export default async function FilesPage({ searchParams }: { searchParams: Promise<{ folder?: string }> }) {
  await requireCompanyId();
  const { folder } = await searchParams;
  const folderId = typeof folder === "string" && folder ? folder : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">書類フォルダ</h1>
        <p className="mt-1 text-sm text-slate-600">
          契約書・見積書のPDF・写真など、会社の書類をフォルダに分けて保存できます。PDFと画像はそのまま表示・印刷できます。
        </p>
      </div>
      <FileManager key={folderId ?? "root"} folderId={folderId} />
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

// 表示中のファイルの操作。画像はページごと印刷(ボタン類は印刷しない)、PDFは埋め込んだPDFを印刷する。
export function FileViewerActions({
  id,
  name,
  memo,
  viewable,
  src,
  back,
  autoPrint,
}: {
  id: string;
  name: string;
  memo: string;
  viewable: "pdf" | "image" | null;
  src: string;
  back: string;
  autoPrint: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  function print() {
    if (viewable === "pdf") {
      const frame = document.getElementById("file-preview") as HTMLIFrameElement | null;
      try {
        frame?.contentWindow?.focus();
        frame?.contentWindow?.print();
      } catch {
        // PDFの表示方法によっては直接印刷できないので、新しいタブで開いてそこから印刷してもらう
        window.open(src, "_blank", "noopener");
      }
      return;
    }
    window.print();
  }

  useEffect(() => {
    if (!autoPrint || !viewable) return;
    const el = document.getElementById("file-preview") as HTMLImageElement | HTMLIFrameElement | null;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = () => {
      timer = setTimeout(print, viewable === "pdf" ? 800 : 100);
    };
    if (el instanceof HTMLImageElement && el.complete) run();
    else el.addEventListener("load", run, { once: true });
    return () => {
      el.removeEventListener("load", run);
      if (timer) clearTimeout(timer);
    };
    // 最初に開いたときに1回だけ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function patch(body: Record<string, string>) {
    setError(null);
    const res = await fetch(`/api/files/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return setError(json.error || "変更できませんでした");
    router.refresh();
  }

  async function remove() {
    if (!window.confirm(`「${name}」を削除しますか?元に戻せません。`)) return;
    const res = await fetch(`/api/files/${id}`, { method: "DELETE" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return setError(json.error || "削除できませんでした");
    router.push(back);
  }

  return (
    <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
      <div className="flex flex-wrap gap-2">
        {viewable && (
          <button type="button" onClick={print} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700">
            印刷
          </button>
        )}
        <a href={`${src}?download=1`} className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
          ダウンロード
        </a>
        <button type="button" onClick={() => router.push(back)} className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
          フォルダに戻る
        </button>
      </div>
      <div className="flex gap-3 text-xs">
        <button
          type="button"
          onClick={() => {
            const next = window.prompt("新しい名前", name);
            if (next?.trim() && next !== name) patch({ name: next });
          }}
          className="text-indigo-700 hover:underline"
        >
          名前変更
        </button>
        <button
          type="button"
          onClick={() => {
            const next = window.prompt("メモ(何の書類か、期限など)", memo);
            if (next !== null && next !== memo) patch({ memo: next });
          }}
          className="text-indigo-700 hover:underline"
        >
          メモを編集
        </button>
        <button type="button" onClick={remove} className="text-rose-600 hover:underline">
          削除
        </button>
      </div>
      {viewable === "pdf" && <p className="text-xs text-slate-500">印刷画面が出ないときは「ダウンロード」してから印刷してください。</p>}
      {error && <p className="text-xs text-rose-700">{error}</p>}
    </div>
  );
}

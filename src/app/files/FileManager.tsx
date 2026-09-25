"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { FileIcon, FolderIcon } from "@/components/icons";

type FileRow = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  memo: string | null;
  uploadedByName: string;
  createdAt: string;
  viewable: "pdf" | "image" | null;
  folderLabel?: string;
};

type Listing = {
  folder: { id: string; name: string; parentId: string | null } | null;
  path: { id: string; name: string }[];
  folders: {
    id: string;
    name: string;
    folderCount: number;
    fileCount: number;
  }[];
  files: FileRow[];
  usage: { bytes: number; files: number };
  allFolders: { id: string; label: string }[];
};

type MoveTarget = { kind: "file" | "folder"; id: string; name: string };

const MAX_BYTES = 4 * 1024 * 1024;

function bytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 102.4) / 10} KB`;
  return `${Math.round(n / 1024 / 102.4) / 10} MB`;
}

function date(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

function kindLabel(f: FileRow) {
  if (f.viewable === "pdf") return "PDF";
  if (f.viewable === "image") return "画像";
  const ext = f.name.includes(".")
    ? f.name.split(".").pop()!.toUpperCase()
    : "";
  return ext || "ファイル";
}

const linkButton =
  "text-xs text-indigo-700 hover:underline disabled:opacity-50";

export function FileManager({ folderId }: { folderId: string | null }) {
  const router = useRouter();
  const [data, setData] = useState<Listing | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [uploading, setUploading] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FileRow[] | null>(null);
  const [move, setMove] = useState<MoveTarget | null>(null);
  const [moveTo, setMoveTo] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const res = await fetch(
      `/api/folders${folderId ? `?folder=${encodeURIComponent(folderId)}` : ""}`,
    );
    if (res.status === 404) return setNotFound(true);
    if (res.ok) setData(await res.json());
  }, [folderId]);

  useEffect(() => {
    // Fetch-on-mount: setState always lands after the fetch's await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function send(url: string, method: string, body?: unknown) {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok)
      setMessage({ ok: false, text: json.error || "処理に失敗しました" });
    return res.ok ? json : null;
  }

  async function refresh() {
    await load();
    if (results && query.trim()) await search(query);
  }

  async function upload(files: FileList | File[]) {
    const list = [...files];
    if (!list.length) return;
    setMessage(null);
    const errors: string[] = [];
    let saved = 0;
    for (const [i, file] of list.entries()) {
      if (file.size > MAX_BYTES) {
        errors.push(`「${file.name}」は4MBを超えるため保存できません`);
        continue;
      }
      setUploading(`${i + 1} / ${list.length} 件目を保存中: ${file.name}`);
      const form = new FormData();
      form.append("file", file);
      if (folderId) form.append("folderId", folderId);
      const res = await fetch("/api/files", { method: "POST", body: form });
      const json = await res.json().catch(() => ({}));
      if (res.ok) saved++;
      else errors.push(json.error || `「${file.name}」を保存できませんでした`);
    }
    setUploading(null);
    if (inputRef.current) inputRef.current.value = "";
    setMessage(
      errors.length
        ? {
            ok: false,
            text: [saved ? `${saved}件保存しました。` : "", ...errors].join(
              " ",
            ),
          }
        : { ok: true, text: `${saved}件のファイルを保存しました` },
    );
    refresh();
  }

  async function newFolder() {
    const name = window.prompt(
      "新しいフォルダの名前(例: 契約書、2026年度 請求書)",
    );
    if (!name?.trim()) return;
    setMessage(null);
    if (await send("/api/folders", "POST", { name, parentId: folderId })) {
      setMessage({ ok: true, text: `フォルダ「${name.trim()}」を作りました` });
      load();
    }
  }

  async function rename(kind: "file" | "folder", id: string, current: string) {
    const name = window.prompt("新しい名前", current);
    if (!name?.trim() || name === current) return;
    setMessage(null);
    if (
      await send(
        `/api/${kind === "file" ? "files" : "folders"}/${id}`,
        "PATCH",
        { name },
      )
    )
      refresh();
  }

  async function remove(kind: "file" | "folder", id: string, name: string) {
    if (
      !window.confirm(
        kind === "file"
          ? `「${name}」を削除しますか?元に戻せません。`
          : `フォルダ「${name}」を削除しますか?`,
      )
    )
      return;
    setMessage(null);
    if (
      await send(
        `/api/${kind === "file" ? "files" : "folders"}/${id}`,
        "DELETE",
      )
    ) {
      setMessage({ ok: true, text: `「${name}」を削除しました` });
      refresh();
    }
  }

  async function doMove() {
    if (!move) return;
    const body =
      move.kind === "file"
        ? { folderId: moveTo || null }
        : { parentId: moveTo || null };
    if (
      await send(
        `/api/${move.kind === "file" ? "files" : "folders"}/${move.id}`,
        "PATCH",
        body,
      )
    ) {
      const dest = moveTo
        ? data?.allFolders.find((f) => f.id === moveTo)?.label
        : "いちばん上";
      setMessage({
        ok: true,
        text: `「${move.name}」を「${dest}」に移動しました`,
      });
      setMove(null);
      refresh();
    }
  }

  async function search(q: string) {
    if (!q.trim()) return setResults(null);
    const res = await fetch(`/api/files/search?q=${encodeURIComponent(q)}`);
    setResults(res.ok ? await res.json() : []);
  }

  if (notFound) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
        フォルダが見つかりません(削除された可能性があります)。
        <Link href="/files" className="ml-2 text-indigo-700 hover:underline">
          書類フォルダのトップへ
        </Link>
      </div>
    );
  }

  const actions = (f: FileRow) => (
    <>
      {f.viewable && (
        <Link href={`/files/${f.id}?print=1`} className={linkButton}>
          印刷
        </Link>
      )}
      <a href={`/api/files/${f.id}?download=1`} className={linkButton}>
        保存
      </a>
      <button
        type="button"
        onClick={() => rename("file", f.id, f.name)}
        className={linkButton}
      >
        名前変更
      </button>
      <button
        type="button"
        onClick={() => {
          setMove({ kind: "file", id: f.id, name: f.name });
          setMoveTo(folderId ?? "");
        }}
        className={linkButton}
      >
        移動
      </button>
      <button
        type="button"
        onClick={() => remove("file", f.id, f.name)}
        className="text-xs text-rose-600 hover:underline"
      >
        削除
      </button>
    </>
  );

  const fileRows = (rows: FileRow[], showFolder: boolean) => (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs whitespace-nowrap text-slate-500">
          <tr>
            <th className="px-4 py-2">名前</th>
            {showFolder && <th className="px-4 py-2">フォルダ</th>}
            <th className="px-4 py-2">種類</th>
            <th className="px-4 py-2 text-right">サイズ</th>
            <th className="px-4 py-2">保存日</th>
            <th className="hidden px-4 py-2 sm:table-cell print:hidden" />
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((f) => (
            <tr key={f.id} className="align-top">
              <td className="min-w-[12rem] px-4 py-2">
                <Link
                  href={`/files/${f.id}`}
                  className="flex items-start gap-2 font-medium text-slate-900 hover:text-indigo-700 hover:underline"
                >
                  <FileIcon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                  <span className="break-all">{f.name}</span>
                </Link>
                {f.memo && (
                  <div className="mt-0.5 pl-6 text-xs text-slate-500">
                    {f.memo}
                  </div>
                )}
                {/* スマホでは操作を名前の下に出す(横にスクロールしなくても押せるように) */}
                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 pl-6 sm:hidden print:hidden">
                  {actions(f)}
                </div>
              </td>
              {showFolder && (
                <td className="px-4 py-2 text-xs whitespace-nowrap text-slate-600">
                  {f.folderLabel || "いちばん上"}
                </td>
              )}
              <td className="px-4 py-2 text-xs whitespace-nowrap text-slate-600">
                {kindLabel(f)}
              </td>
              <td className="px-4 py-2 text-right text-xs whitespace-nowrap text-slate-600 tabular-nums">
                {bytes(f.size)}
              </td>
              <td className="px-4 py-2 text-xs whitespace-nowrap text-slate-600">
                {date(f.createdAt)}
                <div className="text-slate-400">{f.uploadedByName}</div>
              </td>
              <td className="hidden space-x-3 px-4 py-2 text-right whitespace-nowrap sm:table-cell print:hidden">
                {actions(f)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div
      className="space-y-4"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDragging(false);
        upload(e.dataTransfer.files);
      }}
    >
      <nav
        className="flex flex-wrap items-center gap-1 text-sm"
        aria-label="現在のフォルダ"
      >
        <Link
          href="/files"
          className={
            data?.path.length
              ? "text-indigo-700 hover:underline"
              : "font-semibold text-slate-900"
          }
        >
          書類フォルダ
        </Link>
        {data?.path.map((p, i) => (
          <span key={p.id} className="flex items-center gap-1">
            <span className="text-slate-400">/</span>
            {i === data.path.length - 1 ? (
              <span className="font-semibold text-slate-900">{p.name}</span>
            ) : (
              <Link
                href={`/files?folder=${p.id}`}
                className="text-indigo-700 hover:underline"
              >
                {p.name}
              </Link>
            )}
          </span>
        ))}
      </nav>

      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={!!uploading}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
        >
          ファイルを追加
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => e.target.files && upload(e.target.files)}
          aria-label="追加するファイル"
        />
        <button
          type="button"
          onClick={newFolder}
          className="rounded-md border border-indigo-600 px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-50"
        >
          新しいフォルダ
        </button>
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
        >
          一覧を印刷
        </button>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            search(query);
          }}
          className="flex min-w-0 flex-1 gap-2 sm:max-w-xs sm:flex-none"
        >
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ファイル名・メモで探す"
            className="min-w-0 flex-1 rounded-md border px-2 py-1.5 text-sm"
            aria-label="ファイルを探す"
          />
          <button
            type="submit"
            className="rounded-md border px-3 py-1.5 text-sm whitespace-nowrap text-slate-700 hover:bg-slate-50"
          >
            検索
          </button>
        </form>
      </div>

      {uploading && (
        <div className="rounded-md bg-indigo-50 px-4 py-2 text-sm text-indigo-800">
          {uploading}
        </div>
      )}
      {message && (
        <div
          className={`rounded-md px-4 py-2 text-sm ${message.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"}`}
        >
          {message.text}
        </div>
      )}

      {move && (
        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-indigo-200 bg-indigo-50 p-4 print:hidden">
          <label className="min-w-0 text-xs text-slate-600">
            「{move.name}」の移動先
            <select
              value={moveTo}
              onChange={(e) => setMoveTo(e.target.value)}
              className="mt-1 block w-full max-w-full rounded-md border bg-white px-2 py-1.5 text-sm text-slate-900 sm:w-80"
            >
              <option value="">いちばん上(書類フォルダ)</option>
              {data?.allFolders
                .filter((f) => !(move.kind === "folder" && f.id === move.id))
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
            </select>
          </label>
          <button
            type="button"
            onClick={doMove}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            移動する
          </button>
          <button
            type="button"
            onClick={() => setMove(null)}
            className="text-sm text-slate-600 hover:underline"
          >
            やめる
          </button>
        </div>
      )}

      {results !== null ? (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b px-4 py-2 text-sm">
            <span className="font-medium">
              「{query}」の検索結果({results.length}件)
            </span>
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setResults(null);
              }}
              className="text-xs text-indigo-700 hover:underline print:hidden"
            >
              検索をやめる
            </button>
          </div>
          {results.length ? (
            fileRows(results, true)
          ) : (
            <p className="px-4 py-6 text-center text-sm text-slate-400">
              見つかりませんでした。
            </p>
          )}
        </section>
      ) : !data ? (
        <p className="text-sm text-slate-500">読み込み中...</p>
      ) : (
        <>
          {data.folders.length > 0 && (
            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {data.folders.map((f) => (
                <div
                  key={f.id}
                  className="min-w-0 rounded-xl border border-slate-200 bg-white p-3 shadow-sm break-inside-avoid"
                >
                  <Link
                    href={`/files?folder=${f.id}`}
                    className="flex min-w-0 items-center gap-2.5 hover:text-indigo-700"
                  >
                    <FolderIcon className="h-8 w-8 shrink-0 text-amber-500" />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {f.name}
                      </span>
                      <span className="text-xs text-slate-500">
                        {f.folderCount > 0 && `フォルダ ${f.folderCount}・`}
                        ファイル {f.fileCount}
                      </span>
                    </span>
                  </Link>
                  <div className="mt-2 flex gap-3 border-t pt-2 print:hidden">
                    <button
                      type="button"
                      onClick={() => rename("folder", f.id, f.name)}
                      className={linkButton}
                    >
                      名前変更
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMove({ kind: "folder", id: f.id, name: f.name });
                        setMoveTo(folderId ?? "");
                      }}
                      className={linkButton}
                    >
                      移動
                    </button>
                    <button
                      type="button"
                      onClick={() => remove("folder", f.id, f.name)}
                      className="text-xs text-rose-600 hover:underline"
                    >
                      削除
                    </button>
                  </div>
                </div>
              ))}
            </section>
          )}

          <section
            className={`overflow-hidden rounded-xl border bg-white shadow-sm ${dragging ? "border-2 border-dashed border-indigo-400 bg-indigo-50" : "border-slate-200"}`}
          >
            {data.files.length > 0 ? (
              fileRows(data.files, false)
            ) : (
              <div className="px-4 py-10 text-center text-sm text-slate-500">
                <FileIcon className="mx-auto mb-2 h-8 w-8 text-slate-300" />
                {data.folders.length > 0
                  ? "このフォルダにはファイルがありません。"
                  : "まだ何も入っていません。"}
                <span className="block text-xs text-slate-400 print:hidden">
                  「ファイルを追加」を押すか、ここにファイルをドラッグしてください(PDF・画像・Excelなど、1ファイル4MBまで)。
                </span>
              </div>
            )}
          </section>

          <p className="text-xs text-slate-500">
            保存しているファイル: 全部で {data.usage.files}件・
            {bytes(data.usage.bytes)}
            。PDF・画像はこの画面から表示・印刷でき、それ以外(Excel・Wordなど)は「保存」でダウンロードして開きます。
            {data.folder && (
              <button
                type="button"
                onClick={() =>
                  router.push(
                    data.folder!.parentId
                      ? `/files?folder=${data.folder!.parentId}`
                      : "/files",
                  )
                }
                className="ml-2 text-indigo-700 hover:underline print:hidden"
              >
                ひとつ上のフォルダへ
              </button>
            )}
          </p>
        </>
      )}
    </div>
  );
}

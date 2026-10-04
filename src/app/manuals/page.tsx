"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ManualBody } from "@/components/ManualBody";

type Person = { id: string; name: string };
type Manual = {
  id: string;
  title: string;
  category: string | null;
  body: string;
  pinned: boolean;
  published: boolean;
  updatedAt: string;
  images: { id: string; caption: string | null }[];
  readers: Person[];
  unread: Person[];
};
type Data = { members: Person[]; categories: string[]; manuals: Manual[] };
type Draft = { id?: string; title: string; category: string; body: string; pinned: boolean; published: boolean };

const inputClass = "mt-1 w-full rounded-md border px-3 py-2 text-sm";
const SAMPLE = `# 開店前の準備
1. 照明とエアコンをつける
2. レジのお金を数える(**5万円**あるか確認)
3. 入口のマットを出す

## 気をつけること
- 床がぬれていたらすぐふく
- 分からないことは店長に聞く

注意: レジのお金が合わないときは、数え直してから店長に連絡する`;

// 写真を長い辺1600pxまでに縮めて、JPEGにする(スマホの写真は大きいため)
async function shrink(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b ?? file), "image/jpeg", 0.82));
}

export default function ManualsAdminPage() {
  const [data, setData] = useState<Data | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [preview, setPreview] = useState(false);
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/manuals");
    if (res.ok) setData(await res.json());
  }, []);

  useEffect(() => {
    // Fetch-on-mount: setState always lands after the fetch's await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function save() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    const res = await fetch(draft.id ? `/api/manuals/${draft.id}` : "/api/manuals", {
      method: draft.id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(json.error || "保存できませんでした");
    setMessage(draft.id ? "マニュアルを保存しました(読んだ人も、もう一度読むよう未読に戻ります)" : "マニュアルを作りました。写真を付けるときは、続けてこの画面で選んでください");
    // 新しく作ったら、そのまま写真を付けられるように編集を続ける
    setDraft({ ...draft, id: json.id });
    await load();
  }

  async function upload(files: FileList | null) {
    if (!files?.length || !draft?.id) return;
    setBusy(true);
    setError(null);
    for (const file of Array.from(files)) {
      const form = new FormData();
      const blob = await shrink(file);
      form.append("file", new File([blob], file.name.replace(/\.\w+$/, "") + (blob.type === "image/jpeg" ? ".jpg" : ""), { type: blob.type || file.type }));
      form.append("caption", caption);
      const res = await fetch(`/api/manuals/${draft.id}/images`, { method: "POST", body: form });
      if (!res.ok) {
        setError((await res.json().catch(() => ({}))).error || "写真を追加できませんでした");
        break;
      }
    }
    setCaption("");
    setBusy(false);
    await load();
  }

  async function removeImage(id: string) {
    if (!confirm("この写真を削除しますか?")) return;
    await fetch(`/api/manual-images/${id}`, { method: "DELETE" });
    await load();
  }

  async function remove(m: Manual) {
    if (!confirm(`「${m.title}」を削除しますか?`)) return;
    const res = await fetch(`/api/manuals/${m.id}`, { method: "DELETE" });
    if (res.ok) {
      setMessage("削除しました");
      setDraft(null);
      await load();
    }
  }

  const editing = draft?.id ? data?.manuals.find((m) => m.id === draft.id) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">マニュアル</h1>
          <p className="mt-1 text-sm text-slate-600">
            仕事の手順やルールを書いて、スタッフがスマホ(スタッフアプリの「マニュアル」)で読めるようにします。写真も付けられます。読んだら「読みました」を押してもらい、誰が読んだかを確かめられます。内容を直すと未読に戻ります。
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/staff/manuals" className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50">
            スタッフの画面で見る
          </Link>
          <button
            onClick={() => {
              setDraft({ title: "", category: "", body: "", pinned: false, published: true });
              setPreview(false);
              setMessage(null);
            }}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700"
          >
            + マニュアルを書く
          </button>
        </div>
      </div>

      {message && <div className="rounded-md bg-emerald-50 px-4 py-2 text-sm text-emerald-800">{message}</div>}

      {data && (
        <ul className="space-y-2">
          {data.manuals.map((m) => (
            <li key={m.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium">
                    {m.pinned && <span className="mr-2 rounded bg-amber-50 px-1.5 py-0.5 text-xs font-normal text-amber-800">大事</span>}
                    {m.title}
                    {!m.published && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-normal text-slate-600">下書き</span>}
                  </p>
                  <p className="text-xs text-slate-500">{[m.category, `${m.updatedAt.replaceAll("-", "/")} 更新`, m.images.length ? `写真${m.images.length}枚` : null].filter(Boolean).join(" ・ ")}</p>
                </div>
                <button
                  onClick={() => {
                    setDraft({ id: m.id, title: m.title, category: m.category ?? "", body: m.body, pinned: m.pinned, published: m.published });
                    setPreview(false);
                    setMessage(null);
                  }}
                  className="text-sm font-medium text-indigo-700 hover:underline"
                >
                  編集
                </button>
              </div>
              {m.published && (
                <div className="mt-2 flex items-center gap-2 text-xs">
                  <div className="h-1.5 w-32 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`${data.members.length}人中${m.readers.length}人が読みました`}>
                    <div className="h-full rounded-full bg-emerald-500" style={{ width: `${data.members.length ? (m.readers.length / data.members.length) * 100 : 0}%` }} />
                  </div>
                  <span className="text-slate-600">
                    {m.readers.length}/{data.members.length}人が読みました
                  </span>
                  {m.unread.length > 0 && <span className="truncate text-slate-400">未読: {m.unread.map((u) => u.name).join("、")}</span>}
                </div>
              )}
            </li>
          ))}
          {data.manuals.length === 0 && (
            <li className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">まだマニュアルがありません。「+ マニュアルを書く」から作ってください。</li>
          )}
        </ul>
      )}

      {draft && data && (
        <div className="fixed inset-0 z-20 flex items-end justify-center bg-slate-900/30 p-4 sm:items-center" onClick={() => setDraft(null)}>
          <div onClick={(e) => e.stopPropagation()} className="max-h-[92vh] w-full max-w-3xl space-y-3 overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">{draft.id ? "マニュアルを編集" : "マニュアルを書く"}</h2>
              {editing && (
                <button onClick={() => remove(editing)} className="text-xs text-slate-500 hover:text-rose-700 hover:underline">
                  削除
                </button>
              )}
            </div>
            {error && <div className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
            <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
              <label className="block text-sm">
                <span className="text-slate-600">タイトル</span>
                <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} maxLength={80} placeholder="例: 開店前の準備" className={inputClass} />
              </label>
              <label className="block text-sm">
                <span className="text-slate-600">分類(任意)</span>
                <input value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} list="manual-categories" maxLength={30} placeholder="例: 接客" className={inputClass} />
                <datalist id="manual-categories">
                  {[...new Set([...data.categories, "接客", "レジ", "開店・閉店", "衛生", "ルール"])].map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </label>
            </div>
            <div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-600">本文</span>
                <div className="flex gap-3 text-xs">
                  {!draft.body && (
                    <button onClick={() => setDraft({ ...draft, body: SAMPLE })} className="text-indigo-700 hover:underline">
                      見本を入れる
                    </button>
                  )}
                  <button onClick={() => setPreview(!preview)} className="text-indigo-700 hover:underline">
                    {preview ? "書く画面に戻る" : "見え方を確かめる"}
                  </button>
                </div>
              </div>
              {preview ? (
                <div className="mt-1 max-h-96 overflow-y-auto rounded-md border bg-slate-50 p-4">
                  <ManualBody body={draft.body || "(本文がありません)"} />
                </div>
              ) : (
                <textarea value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} rows={12} className={`${inputClass} font-mono`} placeholder="手順やルールを書いてください" />
              )}
              <p className="mt-1 text-xs text-slate-500">書き方: 「# 見出し」「## 小見出し」「1. 手順」「- 箇条書き」「**太字**」「注意: …」(目立つ枠になります)</p>
            </div>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={draft.pinned} onChange={(e) => setDraft({ ...draft, pinned: e.target.checked })} />
                大事なマニュアルとして上に出す
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={draft.published} onChange={(e) => setDraft({ ...draft, published: e.target.checked })} />
                スタッフに公開する(外すと下書き)
              </label>
            </div>

            {editing && (
              <div className="space-y-2 rounded-lg border border-slate-200 p-3">
                <p className="text-sm font-medium">写真({editing.images.length}/10枚)</p>
                {editing.images.length > 0 && (
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                    {editing.images.map((img) => (
                      <figure key={img.id} className="relative">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/api/manual-images/${img.id}`} alt={img.caption ?? ""} className="aspect-square w-full rounded object-cover" />
                        {img.caption && <figcaption className="truncate text-[11px] text-slate-500">{img.caption}</figcaption>}
                        <button onClick={() => removeImage(img.id)} className="absolute top-1 right-1 rounded-full bg-white/90 px-1.5 text-xs text-rose-700 shadow" aria-label="写真を削除">
                          ✕
                        </button>
                      </figure>
                    ))}
                  </div>
                )}
                {editing.images.length < 10 && (
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <input value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={100} placeholder="写真の説明(任意)" className="min-w-0 flex-1 rounded-md border px-3 py-1.5" />
                    <label className="cursor-pointer rounded-md border border-indigo-600 px-3 py-1.5 text-indigo-700 hover:bg-indigo-50">
                      写真を選ぶ
                      <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => upload(e.target.files)} disabled={busy} />
                    </label>
                  </div>
                )}
              </div>
            )}
            {!draft.id && <p className="text-xs text-slate-500">写真は、いったん保存したあとに付けられます。</p>}

            <div className="flex justify-end gap-2">
              <button onClick={() => setDraft(null)} className="rounded-md border px-4 py-2 text-sm">
                閉じる
              </button>
              <button onClick={save} disabled={busy} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50">
                {busy ? "保存中..." : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

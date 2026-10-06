"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

type Item = { id: string; fileName: string; kind: string; title: string; summary: string; confidence: number; status: string; resultType: string; href: string; note: string | null; userName: string; createdAt: string };
type Result = { ok: true; item: Item } | { ok: false; fileName: string; error: string };

const KIND: Record<string, { label: string; cls: string }> = {
  RECEIVED_INVOICE: { label: "受け取った請求書", cls: "bg-sky-100 text-sky-800" },
  RECEIPT: { label: "領収書・レシート", cls: "bg-emerald-100 text-emerald-800" },
  CONTRACT: { label: "契約書", cls: "bg-violet-100 text-violet-800" },
  OTHER: { label: "その他の書類", cls: "bg-slate-100 text-slate-700" },
};
const OPEN_LABEL: Record<string, string> = { INVOICE: "請求書を開く", EXPENSE: "経費精算を開く", FILE: "書類フォルダを開く" };

export function InboxView() {
  const [items, setItems] = useState<Item[]>([]);
  const [aiEnabled, setAiEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/inbox");
    if (!res.ok) return;
    const json = await res.json();
    setItems(json.items);
    setAiEnabled(json.aiEnabled);
  }, []);

  useEffect(() => {
    // Fetch-on-mount: setState always lands after the fetch's await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function upload(files: FileList | File[]) {
    const list = [...files].slice(0, 10);
    if (!list.length) return;
    setBusy(true);
    setErrors([]);
    const form = new FormData();
    for (const f of list) form.append("files", f);
    const res = await fetch("/api/inbox", { method: "POST", body: form });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setErrors([json.error || "入れられませんでした"]);
    setErrors((json.results as Result[]).filter((r): r is Extract<Result, { ok: false }> => !r.ok).map((r) => `${r.fileName}: ${r.error}`));
    if (input.current) input.current.value = "";
    await load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">AI受付箱</h1>
        <p className="mt-1 text-sm text-slate-600">
          請求書・領収書・契約書など、会社に届いた書類(PDF・写真)をここに入れるだけで、AIがどんな書類かを見分けて振り分けます。受け取った請求書は請求書として、領収書はあなたの経費精算に登録し(仕訳も作ります)、契約書は満了日をお知らせするように書類フォルダへ保存します。
        </p>
        {!aiEnabled && <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">いまはAIを使えないため(AI持ち込みでキーが未登録など)、ファイル名(「請求書」「領収書」「契約書」など)で見分ける簡易モードです。<Link href="/ai-settings" className="ml-1 underline">AIの設定</Link></p>}
      </div>

      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          upload(e.dataTransfer.files);
        }}
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-10 text-center transition ${drag ? "border-indigo-500 bg-indigo-50" : "border-slate-300 bg-white hover:bg-slate-50"}`}
      >
        <span className="text-base font-medium">{busy ? "AIが書類を読んでいます…" : "ここに書類をドラッグ、またはタップして選ぶ"}</span>
        <span className="text-xs text-slate-500">PDF・写真(JPEG/PNG)・1枚4MBまで・一度に10枚まで</span>
        <input ref={input} type="file" multiple accept="application/pdf,image/*" disabled={busy} onChange={(e) => e.target.files && upload(e.target.files)} className="sr-only" />
      </label>

      {errors.length > 0 && (
        <div className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-700">
          {errors.map((e) => (
            <p key={e}>{e}</p>
          ))}
        </div>
      )}

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <h2 className="border-b px-4 py-2 text-sm font-semibold">入れた書類</h2>
        <ul className="divide-y text-sm">
          {items.map((it) => (
            <li key={it.id} className="space-y-1 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${KIND[it.kind]?.cls ?? KIND.OTHER.cls}`}>{KIND[it.kind]?.label ?? "書類"}</span>
                {it.status === "ATTENTION" && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">要確認</span>}
                <span className="font-medium">{it.title}</span>
                <span className="text-xs text-slate-400">{it.fileName}</span>
              </div>
              {it.summary && <p className="text-slate-600">{it.summary}</p>}
              <p className="text-xs text-slate-500">
                {it.note}
                {" ・ "}
                <Link href={it.href} className="text-indigo-700 hover:underline">
                  {OPEN_LABEL[it.resultType] ?? "開く"}
                </Link>
                {" ・ "}
                {new Date(it.createdAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} {it.userName}
              </p>
            </li>
          ))}
          {items.length === 0 && <li className="px-4 py-6 text-center text-slate-400">まだ書類はありません。</li>}
        </ul>
      </section>
    </div>
  );
}

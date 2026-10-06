"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ManualBody } from "@/components/ManualBody";

type Manual = { id: string; title: string; category: string | null; body: string; published: boolean; updatedAt: string; images: { id: string; caption: string | null }[]; read: boolean };

export function ManualView({ id }: { id: string }) {
  const [manual, setManual] = useState<Manual | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/staff-app/manuals/${id}`);
    if (!res.ok) return setMissing(true);
    setManual(await res.json());
  }, [id]);

  useEffect(() => {
    // Fetch-on-mount: setState always lands after the fetch's await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function read() {
    setBusy(true);
    await fetch(`/api/staff-app/manuals/${id}`, { method: "POST" });
    setBusy(false);
    await load();
  }

  if (missing) return <p className="py-10 text-center text-sm text-slate-500">マニュアルが見つかりません。</p>;
  if (!manual) return <p className="py-10 text-center text-sm text-slate-400">読み込み中...</p>;

  return (
    <article className="space-y-4">
      <Link href="/staff/manuals" className="text-sm text-indigo-700">
        ← マニュアル一覧
      </Link>
      <header>
        <p className="text-xs text-slate-500">{[manual.category, `${manual.updatedAt.replaceAll("-", "/")} 更新`].filter(Boolean).join(" ・ ")}</p>
        <h1 className="text-xl font-semibold">{manual.title}</h1>
        {!manual.published && <p className="mt-1 inline-block rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">下書き(スタッフには見えていません)</p>}
      </header>
      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <ManualBody body={manual.body} />
      </div>
      {manual.images.length > 0 && (
        <div className="space-y-3">
          {manual.images.map((img, i) => (
            <figure key={img.id} className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/manual-images/${img.id}`} alt={img.caption ?? `写真${i + 1}`} className="w-full" loading="lazy" />
              {img.caption && <figcaption className="px-3 py-2 text-sm text-slate-600">{img.caption}</figcaption>}
            </figure>
          ))}
        </div>
      )}
      {manual.published && (
        <div className="sticky bottom-20 md:bottom-4">
          {manual.read ? (
            <p className="rounded-xl bg-emerald-50 py-3 text-center text-sm font-medium text-emerald-800 shadow">✓ 読みました</p>
          ) : (
            <button onClick={read} disabled={busy} className="w-full rounded-xl bg-vermilion-600 py-3 font-medium text-white shadow-sm hover:bg-vermilion-700 disabled:opacity-50">
              読みました
            </button>
          )}
        </div>
      )}
    </article>
  );
}

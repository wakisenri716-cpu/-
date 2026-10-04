"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Manual = { id: string; title: string; category: string | null; pinned: boolean; updatedAt: string; excerpt: string; images: number; read: boolean };
type Data = { manuals: Manual[]; categories: string[]; unread: number };

export default function StaffManuals() {
  const [data, setData] = useState<Data | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");

  useEffect(() => {
    fetch("/api/staff-app/manuals")
      .then((res) => (res.ok ? res.json() : null))
      .then(setData)
      .catch(() => {});
  }, []);

  if (!data) return <p className="py-10 text-center text-sm text-slate-400">読み込み中...</p>;
  const q = query.trim().toLowerCase();
  const list = data.manuals.filter((m) => (!category || m.category === category) && (!q || m.title.toLowerCase().includes(q) || m.excerpt.toLowerCase().includes(q)));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">マニュアル</h1>
        <p className="text-sm text-slate-500">{data.unread ? `まだ読んでいないマニュアルが${data.unread}件あります。` : "すべて読みました。"}</p>
      </div>
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="タイトル・内容で探す" className="w-full rounded-xl border px-4 py-2.5 text-sm" type="search" />
      {data.categories.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1 text-sm">
          {["", ...data.categories].map((c) => (
            <button key={c || "all"} onClick={() => setCategory(c)} className={`shrink-0 rounded-full px-3 py-1 ${category === c ? "bg-indigo-600 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200"}`}>
              {c || "すべて"}
            </button>
          ))}
        </div>
      )}
      <ul className="space-y-2">
        {list.map((m) => (
          <li key={m.id}>
            <Link href={`/staff/manuals/${m.id}`} className="block rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
              <p className="flex items-center gap-2 font-medium">
                {!m.read && <span className="h-2 w-2 shrink-0 rounded-full bg-rose-500" aria-label="未読" />}
                <span className="min-w-0 flex-1">{m.title}</span>
                {m.pinned && <span className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-800">大事</span>}
              </p>
              <p className="mt-1 line-clamp-2 text-sm text-slate-500">{m.excerpt}</p>
              <p className="mt-1 text-xs text-slate-400">{[m.category, `${m.updatedAt.replaceAll("-", "/")} 更新`, m.images ? `写真${m.images}枚` : null, m.read ? "読みました" : null].filter(Boolean).join(" ・ ")}</p>
            </Link>
          </li>
        ))}
        {list.length === 0 && <li className="rounded-xl bg-white p-8 text-center text-sm text-slate-500 ring-1 ring-slate-200">{data.manuals.length ? "条件に合うマニュアルはありません" : "まだマニュアルがありません"}</li>}
      </ul>
    </div>
  );
}

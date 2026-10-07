"use client";

import Link from "next/link";
import { useState } from "react";
import type { DocTool, DOC_CATEGORIES } from "@/lib/docHub";

export default function DocHubView({ tools, categories, usage }: { tools: DocTool[]; categories: typeof DOC_CATEGORIES; usage: Record<string, number> }) {
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const shown = tools.filter((t) => !query || `${t.title}${t.description}${t.keywords.join("")}`.toLowerCase().includes(query));
  return (
    <div className="space-y-6">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="例: 契約書 / お礼状 / 求人 / 議事録" aria-label="作りたい書類" className="w-full max-w-md rounded-md border border-slate-300 bg-white px-3 py-2 text-sm" />
      {shown.length === 0 && <p className="text-sm text-slate-600">合う書類が見つかりませんでした。AIアシスタントに「◯◯を作りたい」と聞いてみてください。</p>}
      {(Object.keys(categories) as DocTool["category"][]).map((cat) => {
        const list = shown.filter((t) => t.category === cat);
        if (!list.length) return null;
        return (
          <section key={cat} className="space-y-2">
            <h2 className="text-sm font-semibold text-slate-600">{categories[cat]}</h2>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((t) => (
                <li key={t.href}>
                  <Link href={t.href} className="flex h-full flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-colors hover:border-indigo-300 hover:bg-indigo-50/40">
                    <span className="flex items-center gap-2">
                      <span className="font-medium">{t.title}</span>
                      {t.ai && <span className="rounded-full border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[11px] font-medium text-indigo-700">AI</span>}
                    </span>
                    <span className="mt-1 flex-1 text-sm text-slate-600">{t.description}</span>
                    {usage[t.href] ? <span className="mt-2 text-xs text-slate-500">今月 AI で{usage[t.href]}回</span> : null}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

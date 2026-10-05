"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { SparkleIcon } from "@/components/icons";

export type BriefingView = { date: string; headline: string; items: { title: string; reason: string; href: string }[]; notes: string[]; mode: string };

// ダッシュボードの「今朝のAIブリーフィング」。今日の分がまだなければ、開いたときに一度だけ作る。
export function BriefingCard({ initial }: { initial: BriefingView | null }) {
  const router = useRouter();
  const [briefing, setBriefing] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (initial || started.current) return;
    started.current = true;
    (async () => {
      const res = await fetch("/api/briefing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ifMissing: true }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return setError(json.error || "今朝のまとめを作れませんでした");
      setBriefing(json.briefing);
      router.refresh();
    })();
  }, [initial, router]);

  return (
    <section className="rounded-xl border border-indigo-200 bg-white p-4 shadow-sm print:hidden">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 font-semibold text-indigo-900">
          <SparkleIcon className="h-4 w-4" />
          今朝のAIブリーフィング
        </h2>
        <Link href="/briefing" className="text-sm text-indigo-700 hover:underline">
          くわしく見る →
        </Link>
      </div>
      {!briefing ? (
        <p className="mt-2 text-sm text-slate-500">{error ?? "AIが今日やることをまとめています…"}</p>
      ) : (
        <>
          <p className="mt-2 text-sm">{briefing.headline}</p>
          {briefing.items.length > 0 && (
            <ol className="mt-3 space-y-2">
              {briefing.items.slice(0, 3).map((item, i) => (
                <li key={i} className="flex gap-2 text-sm">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs font-semibold text-white">{i + 1}</span>
                  <span className="min-w-0">
                    <Link href={item.href} className="font-medium text-slate-900 hover:text-indigo-700 hover:underline">
                      {item.title}
                    </Link>
                    <span className="block text-xs text-slate-500">{item.reason}</span>
                  </span>
                </li>
              ))}
            </ol>
          )}
          {briefing.items.length > 3 && <p className="mt-2 text-xs text-slate-500">ほかに {briefing.items.length - 3}件あります。</p>}
        </>
      )}
    </section>
  );
}

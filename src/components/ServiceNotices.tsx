"use client";

import { useEffect, useState } from "react";

type Notice = { id: string; title: string; body: string | null; level: string };
const KEY = "dismissedNotices";

// 運営からのお知らせ(閉じたものは、この端末では出さない)
export function ServiceNotices({ notices }: { notices: Notice[] }) {
  const [hidden, setHidden] = useState<string[] | null>(null);

  useEffect(() => {
    let saved: string[] = [];
    try {
      saved = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    } catch {}
    // 保存された「閉じた」を読み終えてから出す(読み込み直後にちらつかないように)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHidden(Array.isArray(saved) ? saved : []);
  }, []);

  if (!hidden) return null;
  const visible = notices.filter((n) => !hidden.includes(n.id));
  if (!visible.length) return null;

  function dismiss(id: string) {
    const next = [...hidden!, id].slice(-50);
    setHidden(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {}
  }

  return (
    <div className="mb-4 space-y-2 print:hidden">
      {visible.map((n) => (
        <div key={n.id} className={`flex items-start justify-between gap-3 rounded-md border px-4 py-3 text-sm ${n.level === "warning" ? "border-amber-300 bg-amber-50 text-amber-900" : "border-indigo-200 bg-indigo-50 text-indigo-900"}`}>
          <div>
            <p className="font-medium">
              {n.level === "warning" ? "【重要】" : "【お知らせ】"}
              {n.title}
            </p>
            {n.body && <p className="mt-1 whitespace-pre-wrap">{n.body}</p>}
          </div>
          <button onClick={() => dismiss(n.id)} aria-label="閉じる" className="shrink-0 px-1 text-lg leading-none opacity-60 hover:opacity-100">
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import type { SetupStep } from "@/lib/dashboard";

const KEY = "setupGuideHidden";

// 「閉じる」はこのブラウザだけに覚えておく(表示のしかたの好みなので、サーバーには保存しない)
function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

function readHidden() {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function SetupGuide({ steps }: { steps: SetupStep[] }) {
  const hidden = useSyncExternalStore(subscribe, readHidden, () => false);
  const done = steps.filter((s) => s.done).length;
  if (hidden || done === steps.length) return null;

  function hide() {
    try {
      window.localStorage.setItem(KEY, "1");
      window.dispatchEvent(new StorageEvent("storage"));
    } catch {
      // 保存できない環境(プライベートモードなど)では何もしない
    }
  }

  return (
    <section className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-slate-900">はじめにやること</h2>
          <p className="mt-0.5 text-xs text-slate-600">
            {steps.length}つのうち {done}つ 完了
          </p>
        </div>
        <button onClick={hide} className="text-xs text-slate-500 hover:underline">
          閉じる
        </button>
      </div>
      <div className="mt-2 h-1.5 rounded-full bg-white" aria-hidden>
        <div className="h-1.5 rounded-full bg-indigo-500" style={{ width: `${(done / steps.length) * 100}%` }} />
      </div>
      <ol className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.key}>
            <Link
              href={s.href}
              className={`flex h-full items-start gap-2 rounded-lg border bg-white p-3 transition hover:border-indigo-300 ${s.done ? "border-slate-200 opacity-60" : "border-slate-200"}`}
            >
              <span
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                  s.done ? "bg-emerald-500 text-white" : "border border-slate-300 text-slate-500"
                }`}
                aria-label={s.done ? "完了" : "未完了"}
              >
                {s.done ? "✓" : i + 1}
              </span>
              <span>
                <span className={`block text-sm font-medium ${s.done ? "text-slate-500 line-through" : "text-slate-900"}`}>{s.label}</span>
                <span className="block text-xs text-slate-500">{s.detail}</span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

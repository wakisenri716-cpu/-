"use client";

import Link from "next/link";
import { Fragment, useEffect, useRef, useState } from "react";
import { SparkleIcon } from "@/components/icons";

type Turn = { role: "user" | "assistant"; text: string };

const SUGGESTIONS = ["有給はあと何日?", "次のシフトはいつ?", "今月は何時間働いた?", "経費精算はどうなった?", "申請の状況は?", "レジ締めのやり方は?"];

function Text({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((line, i) => (
        <Fragment key={i}>
          {i > 0 && <br />}
          {line.split(/(\[[^\]]+\]\(\/[^)\s]*\))/g).map((p, j) => {
            const m = p.match(/^\[([^\]]+)\]\((\/[^)\s]*)\)$/);
            return m ? (
              <Link key={j} href={m[2]} className="font-medium text-indigo-700 underline">
                {m[1]}
              </Link>
            ) : (
              <Fragment key={j}>{p.replace(/\*\*(.+?)\*\*/g, "$1")}</Fragment>
            );
          })}
        </Fragment>
      ))}
    </>
  );
}

export function StaffAsk() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ behavior: "smooth" }), [turns, busy]);

  async function ask(q: string) {
    const text = q.trim();
    if (!text || busy) return;
    const history = [...turns, { role: "user" as const, text }];
    setTurns(history);
    setInput("");
    setBusy(true);
    setError(null);
    const res = await fetch("/api/staff-app/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ history }) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(json.error || "答えられませんでした");
    setTurns([...history, { role: "assistant", text: json.reply }]);
  }

  return (
    <div className="space-y-4 pb-36 md:pb-4">
      <div>
        <h1 className="flex items-center gap-1.5 text-xl font-semibold">
          <SparkleIcon className="h-5 w-5 text-indigo-600" />
          AIに聞く
        </h1>
        <p className="mt-1 text-sm text-slate-600">自分のシフト・有給・勤務時間・経費精算・申請のことや、社内のマニュアルについて聞けます。ほかの人のことや給料の額は答えません。</p>
      </div>
      {turns.length === 0 && (
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button key={s} onClick={() => ask(s)} className="rounded-full border border-indigo-200 bg-white px-3 py-1.5 text-sm text-indigo-700 hover:bg-indigo-50">
              {s}
            </button>
          ))}
        </div>
      )}
      <div className="space-y-3">
        {turns.map((t, i) =>
          t.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-indigo-600 px-4 py-2 text-sm whitespace-pre-wrap text-white [overflow-wrap:anywhere]">{t.text}</div>
            </div>
          ) : (
            <div key={i} className="max-w-[92%] rounded-2xl rounded-bl-sm border border-slate-200 bg-white px-4 py-3 text-sm leading-relaxed shadow-sm [overflow-wrap:anywhere]">
              <Text text={t.text} />
            </div>
          ),
        )}
        {busy && <div className="w-fit rounded-2xl rounded-bl-sm border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500 shadow-sm">調べています…</div>}
        {error && <p className="text-sm text-rose-700">{error}</p>}
        <div ref={end} />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
        className="fixed inset-x-0 bottom-16 z-20 mx-auto flex max-w-2xl gap-2 border-t border-slate-200 bg-slate-50/95 px-4 py-3 backdrop-blur md:static md:border-0 md:bg-transparent md:p-0"
      >
        <input value={input} onChange={(e) => setInput(e.target.value)} maxLength={1000} placeholder="例: 有給はあと何日?" className="min-w-0 flex-1 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm" />
        <button disabled={busy || !input.trim()} className="rounded-full bg-vermilion-600 px-4 py-2 text-sm font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
          聞く
        </button>
      </form>
    </div>
  );
}

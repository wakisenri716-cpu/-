"use client";

import Link from "next/link";
import { Fragment, useEffect, useRef, useState } from "react";

type Turn = { role: "user" | "assistant"; text: string; tools?: string[] };

const SUGGESTIONS = ["今月の利益はいくら?", "入金が遅れている取引先は?", "今月は何にお金を使った?", "今期の顧客別の売上は?", "予算を超えそうな科目は?", "いまやることは?"];
const TOOL_LABEL: Record<string, string> = {
  get_business_summary: "損益・現預金",
  list_receivables: "売掛金",
  list_payables: "買掛金",
  search_journal: "仕訳",
  get_account_balance: "科目の残高",
  get_expense_breakdown: "費用の内訳",
  get_sales_by_customer: "売上分析",
  get_budget_progress: "予算",
  get_todos: "やること",
};

// [名前](/パス) の形のリンクだけをアプリ内リンクにする(外のURLはリンクにしない)
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((line, i) => {
        const parts = line.split(/(\[[^\]]+\]\(\/[^)\s]*\))/g);
        return (
          <Fragment key={i}>
            {i > 0 && <br />}
            {parts.map((p, j) => {
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
        );
      })}
    </>
  );
}

export function AssistantChat({ initialQuestion, aiEnabled }: { initialQuestion: string; aiEnabled: boolean }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const asked = useRef(false);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    const next: Turn[] = [...turns, { role: "user", text: q }];
    setTurns(next);
    setInput("");
    setBusy(true);
    setError(null);
    const res = await fetch("/api/assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ history: next.map(({ role, text }) => ({ role, text })) }) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(json.error || "答えられませんでした");
      return;
    }
    setTurns([...next, { role: "assistant", text: json.reply, tools: json.tools }]);
  }

  useEffect(() => {
    if (initialQuestion && !asked.current) {
      asked.current = true;
      // URLの ?q= で来た質問は最初に一度だけ聞く
      ask(initialQuestion);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuestion]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, busy]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">AIアシスタント</h1>
        <p className="mt-1 text-sm text-slate-600">会社の帳簿・請求書・予算・やることについて、ふつうの言葉で聞いてください。AIが実際のデータを調べて答えます(データを書き換えることはしません)。</p>
        {!aiEnabled && <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">AIのAPIキー(ANTHROPIC_API_KEY)が未設定のため、決まった質問にだけ答える簡易モードです。</p>}
      </div>

      <div className="space-y-3">
        {turns.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-4 text-sm">
            <p className="mb-2 text-slate-600">たとえば、こんなことを聞けます:</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => ask(s)} className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-indigo-800 hover:bg-indigo-100">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {turns.map((t, i) =>
          t.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-indigo-600 px-4 py-2 text-sm whitespace-pre-wrap text-white">{t.text}</div>
            </div>
          ) : (
            <div key={i} className="flex justify-start">
              <div className="max-w-[90%] rounded-2xl rounded-bl-sm border border-slate-200 bg-white px-4 py-3 text-sm leading-relaxed shadow-sm">
                <Rich text={t.text} />
                {t.tools && t.tools.length > 0 && <p className="mt-2 text-xs text-slate-400">調べたデータ: {[...new Set(t.tools)].map((n) => TOOL_LABEL[n] ?? n).join("・")}</p>}
              </div>
            </div>
          ),
        )}
        {busy && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-sm border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500 shadow-sm">データを調べています…</div>
          </div>
        )}
        {error && <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        <div ref={bottom} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
        className="sticky bottom-0 flex gap-2 border-t border-slate-200 bg-slate-50/95 py-3 backdrop-blur"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={500}
          placeholder="例: 先月の交際費はいくら?"
          aria-label="質問"
          className="min-w-0 flex-1 rounded-full border px-4 py-2 text-sm"
        />
        <button disabled={busy || !input.trim()} className="rounded-full bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
          聞く
        </button>
      </form>
    </div>
  );
}

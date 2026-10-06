"use client";

import Link from "next/link";
import { Fragment, useEffect, useRef, useState } from "react";
import { ProposalCard, type Proposal } from "./ProposalCard";

type Turn = { role: "user" | "assistant"; text: string; tools?: string[]; proposals?: Proposal[] };

const SUGGESTIONS = ["今月の利益はいくら?", "入金が遅れている取引先は?", "今月は何にお金を使った?", "予算を超えそうな科目は?", "何かおかしいところはある?", "いまやることは?", "A社に保守費用5万円の請求書を作って", "期限切れの請求書に督促して", "昨日のタクシー2,300円を経費に入れて"];
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
  explain_journal: "仕訳の説明",
  search_data: "データの検索",
  simulate_scenario: "もしもシミュレーション",
  get_reorder: "発注の提案",
  get_budget_variance: "予算の差の原因",
  get_shift_draft: "シフトの自動作成",
  get_price_review: "値上げの検討",
  get_fixed_costs: "固定費の見直し",
  get_tax_forecast: "着地見込みと納税",
  get_labor_analysis: "人件費の分析",
  get_customer_profit: "顧客別の採算",
  get_business_analysis: "経営分析",
  get_anomalies: "いつもと違う動き",
  propose_invoice: "請求書の下書き",
  propose_journal: "仕訳の下書き",
  propose_reminder: "督促メールの下書き",
  propose_end_contract: "契約の終了",
  propose_po_action: "発注書の検収",
  propose_vendor_account: "取引先の科目",
  propose_expense: "経費の入力",
  propose_fix_account: "科目の振替",
  get_account_review: "科目の見直し",
  get_receipt_forecast: "入金予測",
  get_payment_plan: "支払計画",
  get_billing_gaps: "請求漏れ",
  draft_quote: "見積の下書き",
  get_duplicate_parties: "取引先の重複",
  get_year_end: "決算の準備",
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
    setTurns([...next, { role: "assistant", text: json.reply, tools: json.tools, proposals: json.proposals ?? [] }]);
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
        <p className="mt-1 text-sm text-slate-600">会社の帳簿・請求書・予算・やることについて、ふつうの言葉で聞いてください。AIが実際のデータを調べて答えます。請求書・仕訳・督促メール・経費の入力・契約の終了なども頼めます。AIが下書きを作り、あなたが内容を確かめてボタンを押したときだけ確定します。</p>
        {!aiEnabled && <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">いまはAIを使えないため(AI持ち込みでキーが未登録など)、決まった質問にだけ答える簡易モードです。<Link href="/ai-settings" className="ml-1 underline">AIの設定</Link></p>}
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
              <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-indigo-600 px-4 py-2 text-sm whitespace-pre-wrap break-words text-white [overflow-wrap:anywhere]">{t.text}</div>
            </div>
          ) : (
            <div key={i} className="flex justify-start">
              <div className="max-w-[90%] rounded-2xl rounded-bl-sm border border-slate-200 bg-white px-4 py-3 text-sm leading-relaxed shadow-sm [overflow-wrap:anywhere]">
                <Rich text={t.text} />
                {t.proposals?.map((p) => (
                  <ProposalCard
                    key={p.id}
                    proposal={p}
                    onChange={(np) => setTurns((all) => all.map((x, j) => (j === i ? { ...x, proposals: x.proposals?.map((q) => (q.id === np.id ? np : q)) } : x)))}
                  />
                ))}
                {t.tools && t.tools.length > 0 && <p className="mt-2 text-xs text-slate-400">AIが使った機能: {[...new Set(t.tools)].map((n) => TOOL_LABEL[n] ?? n).join("・")}</p>}
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
        <button disabled={busy || !input.trim()} className="rounded-full bg-vermilion-600 px-5 py-2 text-sm font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
          聞く
        </button>
      </form>
    </div>
  );
}

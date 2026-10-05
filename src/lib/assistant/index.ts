import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { formatYen } from "@/lib/format";
import { ASSISTANT_TOOLS, runAssistantTool } from "./tools";

// AIアシスタント: 会社の帳簿・請求書・やることについての質問に、道具(tools.ts)で実際のデータを調べて日本語で答える。
// ANTHROPIC_API_KEY があれば Claude、なければ言葉の手がかりで道具を1つ選んで答える簡易版。

const MODEL = process.env.ANTHROPIC_ASSISTANT_MODEL || "claude-opus-5-5";
const DAILY_LIMIT = Number(process.env.ASSISTANT_DAILY_LIMIT || 100);
const MAX_TURNS = 20;
const MAX_CHARS = 2000;
const MAX_STEPS = 8;

export type ChatTurn = { role: "user" | "assistant"; text: string };
export type AssistantReply = { reply: string; tools: string[]; mode: "claude" | "simple" };

// 画面の一覧(答えに入れるリンクの候補)
const SCREENS = [
  ["/", "ダッシュボード"],
  ["/income-statement", "損益計算書"],
  ["/balance-sheet", "貸借対照表"],
  ["/monthly", "月次推移・予算"],
  ["/monthly/progress", "予算の進み具合"],
  ["/sales-analysis", "売上分析"],
  ["/receivables", "売掛金・買掛金"],
  ["/invoices", "請求書"],
  ["/expenses", "経費精算"],
  ["/bank", "銀行・カード明細"],
  ["/journal", "仕訳帳"],
  ["/ledger", "総勘定元帳"],
  ["/cashflow", "資金繰り予測"],
  ["/tax", "消費税集計"],
  ["/payroll", "給与計算"],
  ["/review", "レビュー待ち"],
  ["/requests", "申請・稟議"],
  ["/duplicates", "二重計上のチェック"],
];

function systemPrompt(companyName: string) {
  return [
    `あなたは「${companyName}」の経理・事務を手伝うAIアシスタントです。使う人は経理の専門家ではないことが多いので、やさしい日本語で、結論から短く答えてください。`,
    "数字は必ず道具で会社のデータを調べてから答え、推測で数字を作らないでください。データにないことは「データがありません」と言ってください。",
    "金額は「1,234,567円」のように円で書いてください。税務の判断が必要なことは「目安」と添え、税理士への確認をすすめてください。",
    "あなたはデータを読むことだけができ、仕訳や請求書を作ったり変えたりはできません。頼まれたら、どの画面でできるかを案内してください。",
    "関係する画面があれば、答えの最後に [画面の名前](/パス) の形でリンクを1〜3個つけてください。使えるパスは次のとおりです(道具の結果に link があればそれも使えます):",
    SCREENS.map(([href, label]) => `${label}: ${href}`).join(" / "),
  ].join("\n");
}

function client() {
  return new Anthropic();
}

async function askClaude(companyId: string, companyName: string, history: ChatTurn[]): Promise<AssistantReply> {
  const today = jstDateKey(new Date());
  const messages: Anthropic.Beta.BetaMessageParam[] = history.map((t) => ({ role: t.role, content: t.text }));
  // 今日の日付は、キャッシュを効かせるため system ではなく最後の質問に添える
  const last = messages[messages.length - 1];
  messages[messages.length - 1] = { role: "user", content: `${last.content as string}\n\n(今日は ${today} です)` };
  const used: string[] = [];

  for (let step = 0; step < MAX_STEPS; step++) {
    const response = await client().beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: [{ type: "text", text: systemPrompt(companyName), cache_control: { type: "ephemeral" } }],
      tools: ASSISTANT_TOOLS,
      messages,
      output_config: { effort: "medium" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    if (response.stop_reason === "refusal") return { reply: "すみません、この質問にはお答えできません。聞き方を変えてお試しください。", tools: used, mode: "claude" };
    messages.push({ role: "assistant", content: response.content });
    if (response.stop_reason === "pause_turn") continue;
    const calls = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (response.stop_reason !== "tool_use" || calls.length === 0) {
      const text = response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return { reply: text || "うまく答えられませんでした。もう一度聞いてください。", tools: used, mode: "claude" };
    }
    // 道具はまとめて実行し、結果を1つのメッセージで返す
    const results = await Promise.all(
      calls.map(async (call): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
        used.push(call.name);
        try {
          const out = await runAssistantTool(companyId, call.name, (call.input ?? {}) as Record<string, unknown>);
          return { type: "tool_result", tool_use_id: call.id, content: JSON.stringify(out) };
        } catch (error) {
          return { type: "tool_result", tool_use_id: call.id, content: error instanceof Error ? error.message : "調べられませんでした", is_error: true };
        }
      }),
    );
    messages.push({ role: "user", content: results });
  }
  return { reply: "調べることが多すぎて、答えをまとめられませんでした。質問を分けてお試しください。", tools: used, mode: "claude" };
}

// APIキーがないときの簡易版: 言葉の手がかりで道具を1つ選び、結果を文章にする
async function askSimple(companyId: string, question: string): Promise<AssistantReply> {
  const q = question.normalize("NFKC");
  const preset = /先月/.test(q) ? "last-month" : /前期|去年|昨年/.test(q) ? "last-fy" : /今期|今年|年度/.test(q) ? "this-fy" : "this-month";
  const label = { "last-month": "先月", "last-fy": "前期", "this-fy": "今期", "this-month": "今月" }[preset];
  const run = (name: string, input: Record<string, unknown> = {}) => runAssistantTool(companyId, name, input) as Promise<Record<string, unknown>>;

  if (/やること|タスク|何をすれば|todo/i.test(q)) {
    const r = (await run("get_todos")) as { todos: { label: string; count: number; link: string }[] };
    if (!r.todos.length) return { reply: "いま急いでやることはありません。", tools: ["get_todos"], mode: "simple" };
    return { reply: ["いまやることは次のとおりです。", ...r.todos.map((t) => `・${t.label}(${t.count}件) [開く](${t.link})`)].join("\n"), tools: ["get_todos"], mode: "simple" };
  }
  if (/未入金|入金待ち|売掛|回収/.test(q)) {
    const r = (await run("list_receivables")) as { total: number; overdueTotal: number; byParty: { name: string; remaining: number }[] };
    return {
      reply: [`入金待ちは合計 ${formatYen(r.total)} です(うち期日を過ぎたもの ${formatYen(r.overdueTotal)})。`, ...r.byParty.slice(0, 5).map((p) => `・${p.name}: ${formatYen(p.remaining)}`), "[売掛金・買掛金](/receivables)"].join("\n"),
      tools: ["list_receivables"],
      mode: "simple",
    };
  }
  if (/未払|支払待ち|買掛|支払い/.test(q)) {
    const r = (await run("list_payables")) as { total: number; overdueTotal: number; byParty: { name: string; remaining: number }[] };
    return {
      reply: [`支払待ちは合計 ${formatYen(r.total)} です(うち期日を過ぎたもの ${formatYen(r.overdueTotal)})。`, ...r.byParty.slice(0, 5).map((p) => `・${p.name}: ${formatYen(p.remaining)}`), "[売掛金・買掛金](/receivables)"].join("\n"),
      tools: ["list_payables"],
      mode: "simple",
    };
  }
  if (/費用|経費|何に使|内訳/.test(q)) {
    const r = (await run("get_expense_breakdown", { preset })) as { total: number; accounts: { account: string; amount: number }[] };
    return { reply: [`${label}の費用は合計 ${formatYen(r.total)} です。多い順に:`, ...r.accounts.slice(0, 5).map((a) => `・${a.account}: ${formatYen(a.amount)}`), "[損益計算書](/income-statement)"].join("\n"), tools: ["get_expense_breakdown"], mode: "simple" };
  }
  if (/予算/.test(q)) {
    const r = (await run("get_budget_progress")) as { alerts: number };
    return { reply: `予算で気をつけたい科目は ${r.alerts}件 です。詳しくは画面で確かめてください。\n[予算の進み具合](/monthly/progress)`, tools: ["get_budget_progress"], mode: "simple" };
  }
  if (/顧客|お客|取引先別|ABC|売れ/.test(q)) {
    const r = (await run("get_sales_by_customer", { preset })) as { total: number; customers: { name: string; amount: number; rank: string }[] };
    return { reply: [`${label}の売上(税抜)は ${formatYen(r.total)} です。顧客別の上位:`, ...r.customers.slice(0, 5).map((c) => `・${c.name}(${c.rank}): ${formatYen(c.amount)}`), "[売上分析](/sales-analysis)"].join("\n"), tools: ["get_sales_by_customer"], mode: "simple" };
  }
  if (/利益|売上|もうけ|儲け|損益|赤字|黒字|現金|預金|残高|お金/.test(q)) {
    const r = (await run("get_business_summary", { preset })) as { revenue: number; expense: number; profit: number; cashBalanceNow: number };
    return {
      reply: [`${label}の売上は ${formatYen(r.revenue)}、費用は ${formatYen(r.expense)}、利益は ${formatYen(r.profit)} です。`, `いまの現預金は ${formatYen(r.cashBalanceNow)} です。`, "[損益計算書](/income-statement)"].join("\n"),
      tools: ["get_business_summary"],
      mode: "simple",
    };
  }
  return {
    reply: "いまは簡易モード(AIのAPIキーが未設定)のため、次のような質問に答えられます: 「今月の利益は?」「未入金は?」「支払待ちは?」「今月の費用の内訳は?」「顧客別の売上は?」「やることは?」",
    tools: [],
    mode: "simple",
  };
}

export async function askAssistant(user: { id: string; companyId: string }, input: unknown): Promise<AssistantReply> {
  const raw = Array.isArray(input) ? input : [];
  const history: ChatTurn[] = raw
    .filter((t): t is ChatTurn => !!t && (t.role === "user" || t.role === "assistant") && typeof t.text === "string" && t.text.trim() !== "")
    .slice(-MAX_TURNS)
    .map((t) => ({ role: t.role, text: t.text.slice(0, MAX_CHARS) }));
  // 最初は user、最後も user の質問にする
  while (history.length && history[0].role !== "user") history.shift();
  const question = history[history.length - 1];
  if (!question || question.role !== "user") throw new UserError("質問を入力してください");

  const since = new Date(`${jstDateKey(new Date())}T00:00:00+09:00`);
  if ((await prisma.assistantLog.count({ where: { companyId: user.companyId, createdAt: { gte: since } } })) >= DAILY_LIMIT) {
    throw new UserError(`AIアシスタントへの質問は1日${DAILY_LIMIT}回までです。明日またお試しください`);
  }
  const company = await prisma.company.findUniqueOrThrow({ where: { id: user.companyId }, select: { name: true } });
  let result: AssistantReply;
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      result = await askClaude(user.companyId, company.name, history);
    } catch (error) {
      if (error instanceof Anthropic.RateLimitError) throw new UserError("AIが混み合っています。少し待ってからお試しください");
      if (error instanceof Anthropic.APIError) throw new UserError("AIに問い合わせできませんでした。時間をおいてお試しください");
      throw error;
    }
  } else {
    result = await askSimple(user.companyId, question.text);
  }
  await prisma.assistantLog.create({ data: { companyId: user.companyId, userId: user.id, question: question.text.slice(0, 500), tools: result.tools, mode: result.mode } });
  return result;
}

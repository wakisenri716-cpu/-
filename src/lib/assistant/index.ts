import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { formatYen } from "@/lib/format";
import { ASSISTANT_TOOLS, runAssistantTool } from "./tools";
import { getProposals, type ProposalView } from "./proposals";

// AIアシスタント: 会社の帳簿・請求書・やることについての質問に、道具(tools.ts)で実際のデータを調べて日本語で答える。
// ANTHROPIC_API_KEY があれば Claude、なければ言葉の手がかりで道具を1つ選んで答える簡易版。

const MODEL = process.env.ANTHROPIC_ASSISTANT_MODEL || "claude-opus-5-5";
const DAILY_LIMIT = Number(process.env.ASSISTANT_DAILY_LIMIT || 100);
const MAX_TURNS = 20;
const MAX_CHARS = 2000;
const MAX_STEPS = 8;

export type ChatTurn = { role: "user" | "assistant"; text: string };
export type AssistantReply = { reply: string; tools: string[]; mode: "claude" | "simple"; proposals?: ProposalView[] };

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
  ["/anomalies", "いつもと違うお金の動き"],
  ["/reports/monthly", "AIの月次レポート"],
  ["/collections", "督促・回収"],
  ["/contracts", "契約書の台帳"],
  ["/book-check", "帳簿の健康診断"],
  ["/monthly-close", "月次決算チェックリスト"],
  ["/po-matching", "発注書と請求書の突き合わせ"],
  ["/briefing", "AIの朝のまとめ"],
  ["/ai-watch", "AIの見張り"],
  ["/customer-insights", "顧客の見守り"],
  ["/vendor-insights", "仕入先の見守り"],
  ["/quick-expense", "ひとことで経費入力"],
  ["/account-review", "科目の見直し"],
  ["/receipt-forecast", "入金予測"],
  ["/payment-plan", "支払計画"],
  ["/billing-gaps", "請求漏れのチェック"],
  ["/quotes/ai", "AI見積アシスト"],
  ["/party-duplicates", "取引先の重複"],
  ["/year-end-close", "決算の準備"],
  ["/transfers", "振込データ"],
  ["/vendors", "取引先"],
];

function systemPrompt(companyName: string) {
  return [
    `あなたは「${companyName}」の経理・事務を手伝うAIアシスタントです。使う人は経理の専門家ではないことが多いので、やさしい日本語で、結論から短く答えてください。`,
    "数字は必ず道具で会社のデータを調べてから答え、推測で数字を作らないでください。データにないことは「データがありません」と言ってください。",
    "金額は「1,234,567円」のように円で書いてください。税務の判断が必要なことは「目安」と添え、税理士への確認をすすめてください。",
    "見積を頼まれたら draft_quote で明細の下書きを作り、返ったリンクを「[見積書を作る](リンク)」の形で伝えてください。請求書の発行・仕訳の記帳・督促メール・契約の終了・発注書の検収や二重に取り込んだ請求書の取り消し・取引先のいつもの科目の変更・経費の入力・科目の間違いの振替を頼まれたら、propose_ の道具で下書きを作ってください。下書きは利用者が画面で確かめて「実行する」を押したときだけ確定します。あなたが確定したとは言わず、「下書きを作りました。内容を確かめて実行してください」と伝えてください。必要な情報(金額・相手など)が足りないときは、推測せずに聞き返してください。",
    "それ以外の変更(取消・削除・設定の変更など)はできないので、どの画面でできるかを案内してください。",
    "関係する画面があれば、答えの最後に [画面の名前](/パス) の形でリンクを1〜3個つけてください。使えるパスは次のとおりです(道具の結果に link があればそれも使えます):",
    SCREENS.map(([href, label]) => `${label}: ${href}`).join(" / "),
  ].join("\n");
}

function client() {
  return new Anthropic();
}

async function askClaude(ctx: { companyId: string; userId: string }, companyName: string, history: ChatTurn[]): Promise<AssistantReply> {
  const today = jstDateKey(new Date());
  const messages: Anthropic.Beta.BetaMessageParam[] = history.map((t) => ({ role: t.role, content: t.text }));
  // 今日の日付は、キャッシュを効かせるため system ではなく最後の質問に添える
  const last = messages[messages.length - 1];
  messages[messages.length - 1] = { role: "user", content: `${last.content as string}\n\n(今日は ${today} です)` };
  const used: string[] = [];
  const proposalIds: string[] = [];
  const done = async (reply: string): Promise<AssistantReply> => ({ reply, tools: used, mode: "claude", proposals: await getProposals(ctx.companyId, proposalIds) });

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
    if (response.stop_reason === "refusal") return done("すみません、この質問にはお答えできません。聞き方を変えてお試しください。");
    messages.push({ role: "assistant", content: response.content });
    if (response.stop_reason === "pause_turn") continue;
    const calls = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (response.stop_reason !== "tool_use" || calls.length === 0) {
      const text = response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return done(text || "うまく答えられませんでした。もう一度聞いてください。");
    }
    // 道具はまとめて実行し、結果を1つのメッセージで返す
    const results = await Promise.all(
      calls.map(async (call): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
        used.push(call.name);
        try {
          const out = await runAssistantTool(ctx, call.name, (call.input ?? {}) as Record<string, unknown>);
          const pid = (out as { proposalId?: string } | null)?.proposalId;
          if (pid) proposalIds.push(pid);
          return { type: "tool_result", tool_use_id: call.id, content: JSON.stringify(out) };
        } catch (error) {
          return { type: "tool_result", tool_use_id: call.id, content: error instanceof Error ? error.message : "調べられませんでした", is_error: true };
        }
      }),
    );
    messages.push({ role: "user", content: results });
  }
  return done("調べることが多すぎて、答えをまとめられませんでした。質問を分けてお試しください。");
}

// APIキーがないときの簡易版: 言葉の手がかりで道具を1つ選び、結果を文章にする
async function askSimple(companyId: string, question: string): Promise<AssistantReply> {
  const q = question.normalize("NFKC");
  const preset = /先月/.test(q) ? "last-month" : /前期|去年|昨年/.test(q) ? "last-fy" : /今期|今年|年度/.test(q) ? "this-fy" : "this-month";
  const label = { "last-month": "先月", "last-fy": "前期", "this-fy": "今期", "this-month": "今月" }[preset];
  const run = (name: string, input: Record<string, unknown> = {}) => runAssistantTool({ companyId, userId: "" }, name, input) as Promise<Record<string, unknown>>;

  if (/(請求書|仕訳|督促).*(作|発行|記帳|送)|契約.*(終了にして|解約して)|経費.*(入れて|入力して)|科目.*(にして|変えて)/.test(q)) {
    return { reply: "請求書・仕訳・督促メール・契約の終了・経費の入力などの下書きを作るには、AIのAPIキー(ANTHROPIC_API_KEY)の設定が必要です。いまは各画面から作ってください。\n[請求書](/invoices) [仕訳帳](/journal) [ひとことで経費入力](/quick-expense) [契約書](/contracts)", tools: [], mode: "simple" };
  }
  if (/やること|タスク|何をすれば|todo/i.test(q)) {
    const r = (await run("get_todos")) as { todos: { label: string; count: number; link: string }[] };
    if (!r.todos.length) return { reply: "いま急いでやることはありません。", tools: ["get_todos"], mode: "simple" };
    return { reply: ["いまやることは次のとおりです。", ...r.todos.map((t) => `・${t.label}(${t.count}件) [開く](${t.link})`)].join("\n"), tools: ["get_todos"], mode: "simple" };
  }
  if (/督促|回収/.test(q)) {
    const r = (await run("get_collections")) as { overdueTotal: number; invoices: { customer: string | null; remaining: number; daysOverdue: number; nextStep: string }[] };
    if (!r.invoices.length) return { reply: "期限を過ぎた未入金はありません。", tools: ["get_collections"], mode: "simple" };
    return { reply: [`期限を過ぎた未入金は ${formatYen(r.overdueTotal)} です。`, ...r.invoices.slice(0, 5).map((i) => `・${i.customer ?? "-"}: ${formatYen(i.remaining)}(${i.daysOverdue}日過ぎ)→ ${i.nextStep}`), "[督促・回収](/collections)"].join("\n"), tools: ["get_collections"], mode: "simple" };
  }
  if (/契約|更新|解約/.test(q)) {
    const r = (await run("get_contracts", { withinDays: 90 })) as { monthlyTotal: number; contracts: { title: string; counterparty: string | null; noticeDeadline: string | null; endDate: string | null }[] };
    return {
      reply: [r.contracts.length ? "90日以内に解約・更新の判断が必要な契約:" : "90日以内に判断が必要な契約はありません。", ...r.contracts.slice(0, 5).map((c) => `・${c.title}(${c.counterparty ?? "-"}): ${c.noticeDeadline ? `申し出期限 ${c.noticeDeadline}` : `満了 ${c.endDate}`}`), `毎月かかる契約の金額は ${formatYen(r.monthlyTotal)} です。`, "[契約書の台帳](/contracts)"].join("\n"),
      tools: ["get_contracts"],
      mode: "simple",
    };
  }
  if (/資金|足りな|ショート|資金繰り/.test(q)) {
    const r = (await run("get_cash_outlook")) as { risk: string; cashNow: number; shortageMonth: string | null; lowest: { month: string; closing: number } | null; monthsOfCash: number | null };
    const risk = { LOW: "余裕あり", MEDIUM: "注意", HIGH: "危険" }[r.risk] ?? r.risk;
    return {
      reply: [`資金繰りは「${risk}」です。いまの現預金は ${formatYen(r.cashNow)}${r.monthsOfCash !== null ? `(ふだんの支出の約${r.monthsOfCash}か月分)` : ""}。`, r.shortageMonth ? `${r.shortageMonth} 末に足りなくなる見込みです。` : r.lowest ? `いちばん低いのは ${r.lowest.month} 末の ${formatYen(r.lowest.closing)} の見込みです。` : "", "[資金繰り予測](/cashflow)"].filter(Boolean).join("\n"),
      tools: ["get_cash_outlook"],
      mode: "simple",
    };
  }
  if (/帳簿|点検|健康診断|税理士/.test(q)) {
    const r = (await run("get_book_check")) as { score: number; findings: { title: string }[] };
    return { reply: [`帳簿の点数は ${r.score}点 です。`, ...r.findings.slice(0, 5).map((f) => `・${f.title}`), "[帳簿の健康診断](/book-check)"].join("\n"), tools: ["get_book_check"], mode: "simple" };
  }
  if (/締め|月次決算/.test(q)) {
    const r = (await run("get_close_status")) as { month: string; done: number; total: number; remaining: { item: string }[]; link: string };
    return { reply: [`${r.month} の月次決算は ${r.done}/${r.total} 済んでいます。`, ...r.remaining.slice(0, 5).map((i) => `・残り: ${i.item}`), `[月次決算チェックリスト](${r.link})`].join("\n"), tools: ["get_close_status"], mode: "simple" };
  }
  if (/顧客.*(減|元気|離れ|途絶|変化)|減っている(顧客|取引先)/.test(q)) {
    const r = (await run("get_customer_insights")) as { insights: { customer: string; kind: string; detail: string }[] };
    if (!r.insights.length) return { reply: "目立った変化のある顧客はいません。", tools: ["get_customer_insights"], mode: "simple" };
    return { reply: ["顧客の変化:", ...r.insights.slice(0, 5).map((i) => `・${i.customer}(${i.kind}): ${i.detail}`), "[顧客の見守り](/customer-insights)"].join("\n"), tools: ["get_customer_insights"], mode: "simple" };
  }
  if (/決算/.test(q)) {
    const r = (await run("get_year_end")) as { fiscalYear: string; left: number; total: number; items: { label: string; done: boolean }[] };
    return { reply: [r.left ? `${r.fiscalYear} の決算までに残っている作業が ${r.left}件(全${r.total}件)あります:` : `${r.fiscalYear} の決算の準備はすべて済んでいます。`, ...r.items.filter((i) => !i.done).slice(0, 5).map((i) => `・${i.label}`), "[決算の準備](/year-end-close)"].join("\n"), tools: ["get_year_end"], mode: "simple" };
  }
  if (/(取引先|顧客|仕入先).*(重複|ダブ|二重登録|同じ.*登録)/.test(q)) {
    const r = (await run("get_duplicate_parties")) as { count: number; groups: { strength: string; names: string[] }[] };
    if (!r.count) return { reply: "重複している取引先は見つかりませんでした。", tools: ["get_duplicate_parties"], mode: "simple" };
    return { reply: [`重複しているかもしれない取引先が ${r.count}組 あります:`, ...r.groups.slice(0, 5).map((g) => `・${g.names.join(" / ")}(${g.strength})`), "[取引先の重複](/party-duplicates)"].join("\n"), tools: ["get_duplicate_parties"], mode: "simple" };
  }
  if (/請求(漏れ|もれ|し忘れ|忘れ)|出し忘れ/.test(q)) {
    const r = (await run("get_billing_gaps")) as { count: number; gaps: { title: string; amount: number | null }[] };
    if (!r.count) return { reply: "請求漏れは見つかりませんでした。", tools: ["get_billing_gaps"], mode: "simple" };
    return { reply: [`出し忘れかもしれない請求が ${r.count}件 あります:`, ...r.gaps.slice(0, 5).map((g) => `・${g.title}${g.amount !== null ? `(${formatYen(g.amount)})` : ""}`), "[請求漏れのチェック](/billing-gaps)"].join("\n"), tools: ["get_billing_gaps"], mode: "simple" };
  }
  if (/何を払|支払(計画|い.*(大丈夫|払える|どれ))|払えそう/.test(q)) {
    const r = (await run("get_payment_plan")) as { payTotal: number; deferTotal: number; payments: { vendor: string; amount: number; payDate: string; action: string }[] };
    if (!r.payments.length) return { reply: "この2週間に支払期限の来る請求書はありません。", tools: ["get_payment_plan"], mode: "simple" };
    return {
      reply: [`この2週間の支払いのうち ${formatYen(r.payTotal)} は払えます${r.deferTotal ? `。${formatYen(r.deferTotal)} は支払日をずらす相談が必要です` : ""}。`, ...r.payments.slice(0, 6).map((p) => `・${p.payDate.slice(5)} ${p.vendor} ${formatYen(p.amount)}(${p.action})`), "[支払計画](/payment-plan)"].join("\n"),
      tools: ["get_payment_plan"],
      mode: "simple",
    };
  }
  if (/入金.*(予測|され(そう|る)|入りそう|いつ)|いつ入金/.test(q)) {
    const r = (await run("get_receipt_forecast")) as { total: number; laterThanDue: number; months: { month: string; due: number; predicted: number }[] };
    if (!r.total) return { reply: "入金待ちの請求書はありません。", tools: ["get_receipt_forecast"], mode: "simple" };
    return {
      reply: [`入金待ちは ${formatYen(r.total)} で、そのうち ${formatYen(r.laterThanDue)} は期日より遅れて入りそうです。`, ...r.months.map((m) => `・${Number(m.month.slice(5))}月: 予測 ${formatYen(m.predicted)}(期日どおりなら ${formatYen(m.due)})`), "[入金予測](/receipt-forecast)"].join("\n"),
      tools: ["get_receipt_forecast"],
      mode: "simple",
    };
  }
  if (/科目.*(間違|違って|違う|見直|合って)/.test(q)) {
    const r = (await run("get_account_review")) as { checked: number; suggestions: { date: string; description: string; from: string; to: string }[] };
    if (!r.suggestions.length) return { reply: `経費の仕訳 ${r.checked}件 に、科目が違いそうなものは見つかりませんでした。`, tools: ["get_account_review"], mode: "simple" };
    return { reply: [`科目を見直したい仕訳が ${r.suggestions.length}件 あります:`, ...r.suggestions.slice(0, 5).map((x) => `・${x.date} ${x.description}: ${x.from} → ${x.to}`), "[科目の見直し](/account-review)"].join("\n"), tools: ["get_account_review"], mode: "simple" };
  }
  if (/仕入先|値上が|インボイス登録|登録番号/.test(q)) {
    const r = (await run("get_vendor_insights")) as { insights: { vendor: string; kind: string; detail: string }[] };
    if (!r.insights.length) return { reply: "目立った変化のある仕入先はありません。", tools: ["get_vendor_insights"], mode: "simple" };
    return { reply: ["仕入先の変化:", ...r.insights.slice(0, 5).map((i) => `・${i.vendor}(${i.kind}): ${i.detail}`), "[仕入先の見守り](/vendor-insights)"].join("\n"), tools: ["get_vendor_insights"], mode: "simple" };
  }
  if (/発注書/.test(q)) {
    const r = (await run("get_po_matching")) as { items: { kind: string; vendor: string; message: string }[] };
    const issues = r.items.filter((i) => i.kind !== "MATCH");
    return { reply: [issues.length ? "発注書と確かめたい請求書:" : "発注書と合わない請求書はありません。", ...issues.slice(0, 5).map((i) => `・${i.vendor}: ${i.message}`), "[発注書と請求書の突き合わせ](/po-matching)"].join("\n"), tools: ["get_po_matching"], mode: "simple" };
  }
  if (/未入金|入金待ち|売掛/.test(q)) {
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
  if (/おかしい|異常|いつもと違|不正|変な/.test(q)) {
    const r = (await run("get_anomalies")) as { anomalies: { title: string; detail: string }[] };
    if (!r.anomalies.length) return { reply: "今月は、いつもと違うお金の動きは見つかりませんでした。", tools: ["get_anomalies"], mode: "simple" };
    return { reply: ["いつもと違う動きが見つかりました:", ...r.anomalies.slice(0, 5).map((a) => `・${a.title}: ${a.detail}`), "[いつもと違うお金の動き](/anomalies)"].join("\n"), tools: ["get_anomalies"], mode: "simple" };
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
    reply: "いまは簡易モード(AIのAPIキーが未設定)のため、次のような質問に答えられます: 「今月の利益は?」「未入金は?」「督促が必要なのは?」「更新が近い契約は?」「資金は大丈夫?」「帳簿に問題はある?」「先月の締めは?」「やることは?」",
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
      result = await askClaude({ companyId: user.companyId, userId: user.id }, company.name, history);
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

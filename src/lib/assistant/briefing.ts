import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { formatYen } from "@/lib/format";
import { getCashBalance, getTodos } from "@/lib/dashboard";
import { getAging } from "@/lib/accounting/receivables";
import { nextDay } from "@/lib/accounting/period";
import { getWatches } from "@/lib/aiWatch";

// AIの朝のブリーフィング: 今日の「やること」、昨日のお金の動き、今週の入金・支払の予定をまとめ、
// AIが「今日まずやること」を優先順に選んで理由をつける。会社・日ごとに1つ保存する。
// ANTHROPIC_API_KEY があれば Claude が選び、なければ決まったルールで並べる。

const MODEL = process.env.ANTHROPIC_ASSISTANT_MODEL || "claude-opus-5-5";
const DAILY_LIMIT = Number(process.env.ASSISTANT_DAILY_LIMIT || 100);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
const MAX_ITEMS = 5;

export type BriefingItem = { title: string; reason: string; href: string };

const addDays = (key: string, n: number) => new Date(Date.parse(`${key}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export function weekdayOf(key: string) {
  return WEEKDAYS[new Date(`${key}T00:00:00Z`).getUTCDay()];
}

export async function buildBriefingFacts(companyId: string, now = new Date()) {
  const today = jstDateKey(now);
  const yesterday = addDays(today, -1);
  const weekEnd = addDays(today, 7);
  const yRange = { gte: new Date(`${yesterday}T00:00:00Z`), lt: nextDay(yesterday) };
  const [todos, cash, receivables, payables, bankIn, bankOut, issued, received, inboxAttention, watches] = await Promise.all([
    getTodos(companyId, now),
    getCashBalance(companyId),
    getAging(companyId, "ISSUED", today),
    getAging(companyId, "RECEIVED", today),
    prisma.bankTransaction.aggregate({ where: { companyId, date: yRange, deposit: { gt: 0 } }, _sum: { deposit: true }, _count: true }),
    prisma.bankTransaction.aggregate({ where: { companyId, date: yRange, withdrawal: { gt: 0 } }, _sum: { withdrawal: true }, _count: true }),
    prisma.invoice.aggregate({ where: { companyId, direction: "ISSUED", status: { not: "DRAFT" }, issueDate: yRange }, _sum: { totalAmount: true }, _count: true }),
    prisma.invoice.aggregate({ where: { companyId, direction: "RECEIVED", createdAt: { gte: new Date(`${yesterday}T00:00:00+09:00`), lt: new Date(`${today}T00:00:00+09:00`) } }, _sum: { totalAmount: true }, _count: true }),
    prisma.inboxItem.count({ where: { companyId, status: "ATTENTION", createdAt: { gte: new Date(now.getTime() - 7 * 86_400_000) } } }),
    getWatches(companyId),
  ]);
  const dueSoon = (rows: typeof receivables.rows) =>
    rows
      .filter((r) => r.dueDate && r.dueDate >= today && r.dueDate < weekEnd)
      .slice(0, 8)
      .map((r) => ({ party: r.partyName, amount: r.remaining, dueDate: r.dueDate!, invoiceNumber: r.invoiceNumber }));
  const overdue = receivables.rows.filter((r) => r.overdueDays > 0);
  const overduePayables = payables.rows.filter((r) => r.overdueDays > 0);
  return {
    date: today,
    weekday: weekdayOf(today),
    cash,
    todos: todos.map((t) => ({ key: t.key, label: t.label, count: t.count, detail: t.detail, href: t.href, urgent: t.tone === "rose" })),
    yesterday: {
      date: yesterday,
      deposits: { count: bankIn._count, total: bankIn._sum.deposit ?? 0 },
      withdrawals: { count: bankOut._count, total: bankOut._sum.withdrawal ?? 0 },
      issuedInvoices: { count: issued._count, total: issued._sum.totalAmount ?? 0 },
      receivedInvoices: { count: received._count, total: received._sum.totalAmount ?? 0 },
    },
    thisWeek: {
      incoming: dueSoon(receivables.rows),
      outgoing: dueSoon(payables.rows),
      outgoingTotal: payables.rows.filter((r) => r.dueDate && r.dueDate < weekEnd).reduce((s, r) => s + r.remaining, 0),
    },
    overdueReceivables: { total: overdue.reduce((s, r) => s + r.remaining, 0), parties: [...new Set(overdue.map((r) => r.partyName))].slice(0, 5) },
    overduePayables: { total: overduePayables.reduce((s, r) => s + r.remaining, 0), count: overduePayables.length },
    inboxAttention,
    // AIの見張り(資金・契約・顧客・仕入先・発注書・帳簿など)で気になるもの
    watch: watches.filter((w) => w.status !== "ok").map((w) => ({ key: w.key, label: w.label, status: w.status, headline: w.headline, items: w.items.slice(0, 3), href: w.href })),
  };
}

export type BriefingFacts = Awaited<ReturnType<typeof buildBriefingFacts>>;

// AIが選んでよいリンク先(作り話のURLにしないため、事実に出てくる画面だけにする)
export function allowedHrefs(f: BriefingFacts) {
  return new Set(["/", "/invoices", "/receivables", "/collections", "/cashflow", "/bank", "/inbox", "/assistant", "/ai-watch", ...f.todos.map((t) => t.href), ...(f.watch ?? []).map((w) => w.href)]);
}

// APIキーがないときの決まったルールでの並べ方: 赤(期限切れ・法令)→今週の支払→未入金→そのほか件数の多い順
export function templateBriefing(f: BriefingFacts): { headline: string; items: BriefingItem[]; notes: string[] } {
  const items: BriefingItem[] = [];
  for (const t of f.todos.filter((t) => t.urgent)) {
    // 期日を過ぎた請求書は、未入金の金額と相手がわかるように書く
    const reason = t.key === "overdue" && f.overdueReceivables.total > 0 ? `${f.overdueReceivables.parties.join("・")} などから ${formatYen(f.overdueReceivables.total)} がまだ入金されていません。入金を確かめ、必要なら督促してください。` : t.detail;
    items.push({ title: `${t.label}(${t.count}件)`, reason, href: t.key === "overdue" && f.overdueReceivables.total > 0 ? "/collections" : t.href });
  }
  if (f.thisWeek.outgoing.length) {
    const first = f.thisWeek.outgoing[0];
    items.push({
      title: `今週の支払 ${f.thisWeek.outgoing.length}件の準備`,
      reason: `${first.dueDate.slice(5).replace("-", "/")} に${first.party}へ ${formatYen(first.amount)} などの支払期限があります。残高と振込の予定を確かめてください。`,
      href: "/receivables",
    });
  }
  if (f.overdueReceivables.total > 0 && !f.todos.some((t) => t.key === "overdue")) {
    items.push({ title: "期日を過ぎた未入金の確認", reason: `${f.overdueReceivables.parties.join("・")} などから ${formatYen(f.overdueReceivables.total)} がまだ入金されていません。`, href: "/collections" });
  }
  // 見張りで「要注意」のもの(やることの一覧にない種類だけ)
  const covered = new Set(items.map((i) => i.href));
  for (const w of (f.watch ?? []).filter((w) => w.status === "warn" && !covered.has(w.href) && w.key !== "duplicates")) {
    items.push({ title: w.label, reason: `${w.headline}。${w.items[0] ? `例: ${w.items[0]}` : ""}`, href: w.href });
  }
  if (f.inboxAttention > 0) items.push({ title: `AI受付箱の確認(${f.inboxAttention}件)`, reason: "AIが振り分けられなかった書類があります。中身を見て登録してください。", href: "/inbox" });
  for (const t of [...f.todos.filter((t) => !t.urgent)].sort((a, b) => b.count - a.count)) items.push({ title: `${t.label}(${t.count}件)`, reason: t.detail, href: t.href });
  const picked = items.slice(0, MAX_ITEMS);
  const notes: string[] = [];
  const y = f.yesterday;
  if (y.deposits.count || y.withdrawals.count) notes.push(`昨日は入金 ${y.deposits.count}件 ${formatYen(y.deposits.total)}、出金 ${y.withdrawals.count}件 ${formatYen(y.withdrawals.total)} がありました。`);
  if (y.issuedInvoices.count) notes.push(`昨日は請求書を ${y.issuedInvoices.count}件(${formatYen(y.issuedInvoices.total)})発行しました。`);
  if (f.thisWeek.incoming.length) notes.push(`今週は ${f.thisWeek.incoming.length}件・${formatYen(f.thisWeek.incoming.reduce((s, r) => s + r.amount, 0))} の入金予定があります。`);
  if (f.thisWeek.outgoingTotal > f.cash) notes.push(`今週までの支払 ${formatYen(f.thisWeek.outgoingTotal)} が現預金 ${formatYen(f.cash)} を上回っています。資金繰りを確かめてください。`);
  const headline = picked.length
    ? `今日やることは ${f.todos.length}種類あります。まずは「${picked[0].title}」から始めましょう。`
    : "今日は急ぎのやることはありません。いつもどおりの一日にできそうです。";
  return { headline, items: picked, notes };
}

const SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string", description: "今日の一言まとめ(60字以内)" },
    items: {
      type: "array",
      description: "今日やることを優先順に最大5つ",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "やること(30字以内)" },
          reason: { type: "string", description: "なぜ今日やるのか、数字を入れて(80字以内)" },
          href: { type: "string", description: "開く画面のパス。事実の todos[].href などに出てくるものだけ" },
        },
        required: ["title", "reason", "href"],
        additionalProperties: false,
      },
    },
    notes: { type: "array", items: { type: "string" }, description: "昨日の動きや今週の予定で知っておくとよいこと(最大3つ)" },
  },
  required: ["headline", "items", "notes"],
  additionalProperties: false,
} as const;

async function claudeBriefing(companyName: string, f: BriefingFacts) {
  const response = await new Anthropic().beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    system: [
      {
        type: "text",
        text: [
          `あなたは「${companyName}」の経理・事務の担当者を毎朝サポートする秘書です。渡された今朝の状況(JSON)だけを根拠に、今日まずやることを優先順に選んでください。`,
          "優先の考え方: 期限を過ぎたもの・法令の期限(納付・申告・36協定など)→今日〜数日のうちに期限が来る支払・入金→お金の流れに関わる確認→そのほかの事務。件数が多いだけのものより、期限とお金への影響を重く見てください。",
          "reason には数字(件数・金額・日付)を入れて、なぜ今日なのかを短く書いてください。金額は「1,234,567円」の形で書いてください。",
          "watch はAIの見張り(資金繰り・契約の期限・顧客や仕入先の変化・発注書と請求書の食い違い・帳簿の点検など)の結果です。status が warn のものは、期限やお金への影響を考えて優先に入れてください。",
          "href は JSON の todos[].href・watch[].href、または /receivables・/collections(期限を過ぎた未入金の督促)・/invoices・/bank・/inbox・/cashflow のどれかだけを使ってください。",
          "数字にないことを推測で書かないでください。やることが何もなければ items は空にして、headline でそう伝えてください。",
        ].join("\n"),
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: `今朝(${f.date} ${f.weekday}曜日)の状況です。\n${JSON.stringify(f)}` }],
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  });
  if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") return null;
  const text = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  return sanitize(JSON.parse(text), f);
}

// AIの答えを画面に出せる形に整える(長さの上限・リンク先の確認)
export function sanitize(raw: unknown, f: BriefingFacts) {
  const obj = (raw ?? {}) as { headline?: unknown; items?: unknown; notes?: unknown };
  const str = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
  const hrefs = allowedHrefs(f);
  const items = (Array.isArray(obj.items) ? obj.items : [])
    .map((i: { title?: unknown; reason?: unknown; href?: unknown }) => ({
      title: str(i?.title, 60),
      reason: str(i?.reason, 200),
      href: hrefs.has(String(i?.href ?? "")) ? String(i.href) : "/",
    }))
    .filter((i) => i.title)
    .slice(0, MAX_ITEMS);
  const notes = (Array.isArray(obj.notes) ? obj.notes : []).map((n) => str(n, 200)).filter(Boolean).slice(0, 3);
  const headline = str(obj.headline, 120);
  if (!headline) return null;
  return { headline, items, notes };
}

// 今日のブリーフィングを作る(作り直す)。userId がないとき(毎朝の自動実行)は "system" として記録する。
export async function generateBriefing(companyId: string, userId = "system", now = new Date()) {
  const since = new Date(`${jstDateKey(now)}T00:00:00+09:00`);
  if ((await prisma.assistantLog.count({ where: { companyId, createdAt: { gte: since } } })) >= DAILY_LIMIT) {
    throw new UserError(`AIの利用は1日${DAILY_LIMIT}回までです。明日またお試しください`);
  }
  const [facts, company] = await Promise.all([buildBriefingFacts(companyId, now), prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { name: true } })]);
  let result: ReturnType<typeof templateBriefing> | null = null;
  let mode = "template";
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      result = await claudeBriefing(company.name, facts);
      if (result) mode = "claude";
    } catch (error) {
      // AIに問い合わせできない・答えが読めないときは決まったルールで並べる
      if (!(error instanceof Anthropic.APIError) && !(error instanceof SyntaxError)) throw error;
    }
  }
  result ??= templateBriefing(facts);
  await prisma.assistantLog.create({ data: { companyId, userId, question: `朝のブリーフィング ${facts.date}`, tools: [], mode: `briefing-${mode}` } });
  return prisma.dailyBriefing.upsert({
    where: { companyId_date: { companyId, date: facts.date } },
    create: { companyId, date: facts.date, facts, headline: result.headline, items: result.items, notes: result.notes, mode },
    update: { facts, headline: result.headline, items: result.items, notes: result.notes, mode, createdAt: new Date() },
  });
}

export async function getBriefing(companyId: string, date: string) {
  if (!DATE.test(date)) return null;
  return prisma.dailyBriefing.findUnique({ where: { companyId_date: { companyId, date } } });
}

export async function getBriefingDates(companyId: string) {
  return prisma.dailyBriefing.findMany({ where: { companyId }, orderBy: { date: "desc" }, select: { date: true, mode: true }, take: 14 });
}

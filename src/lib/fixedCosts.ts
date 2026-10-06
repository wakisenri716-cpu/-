import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { aiFor } from "@/lib/ai/access";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { formatYen } from "@/lib/format";
import { groupKey } from "@/lib/budgetVariance";

// 固定費・サブスクの見直し: 帳簿(記帳済みの仕訳)から毎月くり返している支払いを見つけ、
// 月の金額・年間の金額・値上がり・同じ種類の支払いが複数ないか・止まった支払いを出す。
// AIが使えるときは、見直しの候補(解約の確認・プランの見直し・値下げの相談・まとめる)と一言を付ける。何も保存しない。

const MODEL = process.env.ANTHROPIC_ASSISTANT_MODEL || "claude-opus-5-5";
const DAILY_LIMIT = Number(process.env.ASSISTANT_DAILY_LIMIT || 100);
const POSTED = ["AUTO_POSTED", "POSTED_MANUALLY"] as const;
// 売上原価・人件費・減価償却費・税金・利息・一時的な損失などは固定費の見直しの対象外
const SKIP = new Set(["5000", "5100", "5110", "5115", "5120", "5140", "5150", "5160", "5180", "5190", "5900"]);
// 同じ種類のサービスが重なりやすい科目
const OVERLAP = new Set(["5030", "5040", "5080", "5090", "5990"]);

export const ACTIONS = { KEEP: "このまま", CANCEL_CHECK: "使っているか確かめる", REVIEW_PLAN: "プランを見直す", NEGOTIATE: "値下げ・相見積もり", CONSOLIDATE: "まとめる" } as const;
export type FixedAction = keyof typeof ACTIONS;

const addMonths = (month: string, n: number) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
};
const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
};

export type FixedCost = {
  key: string;
  label: string;
  accountCode: string;
  accountName: string;
  monthly: number;
  yearly: number;
  months: number;
  lastMonth: string;
  lastAmount: number;
  before: number;
  changePct: number | null;
  status: "ACTIVE" | "STOPPED";
  flags: ("PRICE_UP" | "SAME_KIND" | "VARIES")[];
  history: { month: string; amount: number }[];
  suggestion: FixedAction | null;
  note: string | null;
  aiNote: string | null;
};

export async function findFixedCosts(companyId: string, now = new Date()) {
  const thisMonth = jstDateKey(now).slice(0, 7);
  const from = addMonths(thisMonth, -12);
  const recent6 = Array.from({ length: 6 }, (_, i) => addMonths(thisMonth, i - 6));
  const [lines, revenueLines] = await Promise.all([
    prisma.journalLine.findMany({
      where: { account: { category: "EXPENSE" }, journalEntry: { companyId, status: { in: [...POSTED] }, sourceType: { not: "OPENING" }, date: { gte: new Date(`${from}-01T00:00:00Z`), lt: new Date(`${addMonths(thisMonth, 1)}-01T00:00:00Z`) } } },
      select: { debit: true, credit: true, account: { select: { code: true, name: true } }, journalEntry: { select: { date: true, description: true } } },
    }),
    prisma.journalLine.findMany({
      where: { account: { category: "REVENUE" }, journalEntry: { companyId, status: { in: [...POSTED] }, sourceType: { not: "OPENING" }, date: { gte: new Date(`${addMonths(thisMonth, -3)}-01T00:00:00Z`), lt: new Date(`${thisMonth}-01T00:00:00Z`) } } },
      select: { debit: true, credit: true, journalEntry: { select: { date: true } } },
    }),
  ]);

  const groups = new Map<string, { label: string; code: string; name: string; byMonth: Map<string, number>; latest: number }>();
  for (const l of lines) {
    if (SKIP.has(l.account.code)) continue;
    const amount = l.debit - l.credit;
    if (amount === 0) continue;
    const key = `${l.account.code}:${groupKey(l.journalEntry.description)}`;
    const g = groups.get(key) ?? { label: l.journalEntry.description, code: l.account.code, name: l.account.name, byMonth: new Map(), latest: 0 };
    const m = l.journalEntry.date.toISOString().slice(0, 7);
    g.byMonth.set(m, (g.byMonth.get(m) ?? 0) + amount);
    if (l.journalEntry.date.getTime() >= g.latest) {
      g.latest = l.journalEntry.date.getTime();
      g.label = l.journalEntry.description.replace(/\s*(\d{2,4}年)?\d{1,2}月分?/g, "").trim() || l.journalEntry.description;
    }
    groups.set(key, g);
  }

  const items: FixedCost[] = [];
  for (const [key, g] of groups) {
    // 直近6か月(今月を除く)のうち3か月以上ある支払いを、毎月くり返す支払いとみなす
    const seen = recent6.filter((m) => (g.byMonth.get(m) ?? 0) > 0);
    if (seen.length < 3) continue;
    const history = [...g.byMonth.entries()].filter(([, a]) => a > 0).sort(([a], [b]) => a.localeCompare(b)).map(([month, amount]) => ({ month, amount }));
    const done = history.filter((h) => h.month < thisMonth);
    const last = done[done.length - 1] ?? history[history.length - 1];
    const earlier = done.slice(0, -1).slice(-6).map((h) => h.amount);
    const before = median(earlier);
    let monthly = median(seen.map((m) => g.byMonth.get(m)!));
    const flags: FixedCost["flags"] = [];
    let changePct = before > 0 ? Math.round((last.amount / before - 1) * 1000) / 10 : null;
    // 毎月同じ金額(サブスクなど)なら、最後の金額が前より上がったら値上がり。
    // 使った分で変わる支払い(電気など)は、直近3か月の平均がその前の3か月より15%以上多いときだけ
    const stable = earlier.length > 0 && earlier.every((a) => Math.abs(a - before) <= before * 0.05);
    if (stable) {
      if (before > 0 && last.amount >= before * 1.05 && last.amount - before >= 300) {
        flags.push("PRICE_UP");
        monthly = last.amount;
      }
    } else {
      const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
      const r3 = avg(done.slice(-3).map((h) => h.amount));
      const p3 = avg(done.slice(-6, -3).map((h) => h.amount));
      changePct = p3 > 0 ? Math.round((r3 / p3 - 1) * 1000) / 10 : null;
      if (p3 > 0 && done.length >= 6 && r3 >= p3 * 1.15 && r3 - p3 >= 1_000) flags.push("PRICE_UP");
      flags.push("VARIES");
    }
    // 先月・先々月とも支払いがなければ止まった(解約済みなら問題なし)
    const status = last.month < addMonths(thisMonth, -2) ? "STOPPED" : "ACTIVE";
    items.push({ key, label: g.label, accountCode: g.code, accountName: g.name, monthly, yearly: monthly * 12, months: history.length, lastMonth: last.month, lastAmount: last.amount, before, changePct, status, flags, history: history.slice(-12), suggestion: null, note: null, aiNote: null });
  }
  // 同じ科目に毎月の支払いが複数(重なっていないか)
  for (const code of OVERLAP) {
    const same = items.filter((i) => i.accountCode === code && i.status === "ACTIVE");
    if (same.length >= 2) for (const i of same) i.flags.push("SAME_KIND");
  }
  for (const i of items) {
    if (i.status === "STOPPED") {
      i.note = `${i.lastMonth.replace("-", "/")}を最後に支払いが止まっています(解約済みなら問題ありません)。`;
      continue;
    }
    if (i.flags.includes("PRICE_UP")) {
      i.suggestion = "NEGOTIATE";
      i.note = i.flags.includes("VARIES")
        ? `直近3か月の平均が、その前の3か月より ${i.changePct}% 多くなっています。料金の単価・プランや使い方を確かめましょう。`
        : `前は月 ${formatYen(i.before)} でしたが、最近は ${formatYen(i.lastAmount)} です(+${i.changePct}%)。値上がりの理由とプランを確かめ、ほかの会社とも比べましょう。`;
    } else if (i.flags.includes("SAME_KIND")) {
      i.suggestion = "CONSOLIDATE";
      i.note = `「${i.accountName}」に毎月の支払いがほかにもあります。同じ目的のサービスが重なっていないか確かめましょう。`;
    }
  }
  items.sort((a, b) => (a.status === b.status ? b.yearly - a.yearly : a.status === "ACTIVE" ? -1 : 1));
  const active = items.filter((i) => i.status === "ACTIVE");
  const monthlyTotal = active.reduce((s, i) => s + i.monthly, 0);
  const revenueMonths = Math.max(1, new Set(revenueLines.map((l) => l.journalEntry.date.toISOString().slice(0, 7))).size);
  const revenue = Math.round(revenueLines.reduce((s, l) => s + l.credit - l.debit, 0) / revenueMonths);
  return {
    items,
    monthlyTotal,
    yearlyTotal: monthlyTotal * 12,
    revenue,
    ratio: revenue > 0 ? monthlyTotal / revenue : null,
    priceUps: active.filter((i) => i.flags.includes("PRICE_UP")).length,
    overlaps: active.filter((i) => i.flags.includes("SAME_KIND")).length,
  };
}

const SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "固定費の見立て(2〜3文)" },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "integer" },
          action: { type: "string", enum: Object.keys(ACTIONS) },
          note: { type: "string", description: "見直しの一言(1文)" },
        },
        required: ["index", "action", "note"],
        additionalProperties: false,
      },
    },
  },
  required: ["summary", "items"],
  additionalProperties: false,
};

export async function reviewFixedCosts(user: { id: string; companyId: string }) {
  const r = await findFixedCosts(user.companyId);
  const active = r.items.filter((i) => i.status === "ACTIVE");
  let summary = active.length
    ? `毎月の支払いは ${active.length}件・月 ${formatYen(r.monthlyTotal)}(年 ${formatYen(r.yearlyTotal)})です。${r.priceUps ? `値上がりしたものが${r.priceUps}件あります。` : ""}${r.overlaps ? `同じ種類の支払いが重なっているかもしれないものが${r.overlaps}件あります。` : ""}`
    : "毎月くり返している支払いは見つかりませんでした(直近6か月のうち3か月以上ある支払いを数えています)。";
  let mode: "claude" | "template" = "template";
  const ai = active.length ? await aiFor(user.companyId) : null;
  if (ai) {
    const today = jstDateKey(new Date());
    if ((await prisma.assistantLog.count({ where: { companyId: user.companyId, createdAt: { gte: new Date(`${today}T00:00:00+09:00`) } } })) >= DAILY_LIMIT) throw new UserError(`AIの利用は1日${DAILY_LIMIT}回までです。明日またお試しください`);
    const list = active.slice(0, 40);
    try {
      const response = await ai.beta.messages.create({
        model: MODEL,
        max_tokens: 4000,
        system: [
          {
            type: "text",
            text: [
              "あなたは小さな会社の経費を見直す担当者です。帳簿から見つけた毎月の支払い(固定費・サブスク)を読み、見直すとよいものにだけ action と短い一言を付けてください。",
              "action: KEEP=このまま, CANCEL_CHECK=使っているか確かめる(解約の候補), REVIEW_PLAN=プランを見直す, NEGOTIATE=値下げの相談・相見積もり, CONSOLIDATE=同じ目的のものをまとめる。",
              "家賃・電気などの欠かせない支払いは、値上がりしていなければ KEEP か何も付けないでください。金額や節約額は渡した数字だけを使い、推測で作らないでください。",
            ].join("\n"),
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [
          {
            role: "user",
            content: JSON.stringify({
              monthlyTotal: r.monthlyTotal,
              averageMonthlyRevenue: r.revenue,
              items: list.map((i, index) => ({ index, name: i.label, account: i.accountName, monthly: i.monthly, yearly: i.yearly, monthsPaid: i.months, lastAmount: i.lastAmount, before: i.before, flags: i.flags })),
            }),
          },
        ],
        output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
      if (response.stop_reason !== "refusal" && response.stop_reason !== "max_tokens") {
        const raw = JSON.parse(
          response.content
            .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
            .map((b) => b.text)
            .join(""),
        ) as { summary?: unknown; items?: unknown };
        for (const x of Array.isArray(raw.items) ? raw.items : []) {
          const v = x as { index?: unknown; action?: unknown; note?: unknown };
          const idx = Number(v.index);
          const item = Number.isInteger(idx) ? list[idx] : undefined;
          if (!item || typeof v.action !== "string" || !(v.action in ACTIONS)) continue;
          const note = typeof v.note === "string" ? v.note.trim().slice(0, 160) : "";
          // 決まったルールで値上がり・重なりを見つけたものは、AIが「このまま」と言っても候補を残す
          if (!(v.action === "KEEP" && item.suggestion)) item.suggestion = v.action as FixedAction;
          if (note) item.aiNote = note;
        }
        const s = typeof raw.summary === "string" ? raw.summary.trim().slice(0, 400) : "";
        if (s) summary = s;
        mode = "claude";
      }
    } catch (error) {
      if (!(error instanceof Anthropic.APIError) && !(error instanceof SyntaxError)) throw error;
    }
    await prisma.assistantLog.create({ data: { companyId: user.companyId, userId: user.id, question: "固定費の見直し", tools: [], mode: `fixedcost-${mode}` } });
  }
  return { ...r, summary, mode };
}

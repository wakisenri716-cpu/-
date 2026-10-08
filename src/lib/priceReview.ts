import Anthropic from "@anthropic-ai/sdk";
import { inventedNumbers } from "@/lib/ai/numberGuard";
import { prisma } from "@/lib/prisma";
import { aiFor } from "@/lib/ai/access";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { formatYen } from "@/lib/format";
import { groupKey } from "@/lib/budgetVariance";
import { newPrice, simulatePriceIncrease } from "@/lib/priceMath";

// 値上げの検討: 費用の上がり方と利益率の変化、売値を長く変えていない品目から、値上げの目安を出す。
// ・直近3か月(今月を除く)を、前年の同じ3か月(なければその前の3か月)と比べる
// ・利益率を前と同じに戻すには売値を何%上げればよいか(数量は変わらない前提)
// ・値上げした場合の1か月の利益の増え方(お客さまが減る割合も入れられる)
// ・取引先へのお知らせ文(AIが使えるときは AI、なければ決まった文)。何も保存しない。

const MODEL = process.env.ANTHROPIC_ASSISTANT_MODEL || "claude-opus-5-5";
const DAILY_LIMIT = Number(process.env.ASSISTANT_DAILY_LIMIT || 100);
const POSTED = ["AUTO_POSTED", "POSTED_MANUALLY"] as const;
const COST_OF_SALES = "5000";
// 毎月の動きと関係の薄い科目(法人税等・売却損・為替差損・減価償却費)は費用の上がり方から外す
const SKIP = new Set(["5160", "5180", "5900", "5100"]);

const addMonths = (month: string, n: number) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
};
const monthStart = (m: string) => new Date(`${m}-01T00:00:00Z`);
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b - 1) * 1000) / 10 : null);

async function periodTotals(companyId: string, from: string, to: string) {
  const lines = await prisma.journalLine.findMany({
    where: { account: { category: { in: ["REVENUE", "EXPENSE"] } }, journalEntry: { companyId, status: { in: [...POSTED] }, sourceType: { not: "OPENING" }, date: { gte: monthStart(from), lt: monthStart(to) } } },
    select: { debit: true, credit: true, account: { select: { id: true, code: true, name: true, category: true } }, journalEntry: { select: { date: true } } },
  });
  // 記帳のある月の数(記帳を始める前の月を0円として比べないよう、1か月あたりに直すのに使う)
  const months = Math.max(1, new Set(lines.map((l) => l.journalEntry.date.toISOString().slice(0, 7))).size);
  const accounts = new Map<string, { code: string; name: string; category: string; amount: number }>();
  for (const l of lines) {
    const a = accounts.get(l.account.id) ?? { code: l.account.code, name: l.account.name, category: l.account.category, amount: 0 };
    a.amount += l.account.category === "REVENUE" ? l.credit - l.debit : l.debit - l.credit;
    accounts.set(l.account.id, a);
  }
  const list = [...accounts.values()];
  const revenue = list.filter((a) => a.category === "REVENUE").reduce((s, a) => s + a.amount, 0);
  const expense = list.filter((a) => a.category === "EXPENSE").reduce((s, a) => s + a.amount, 0);
  const costOfSales = list.filter((a) => a.code === COST_OF_SALES).reduce((s, a) => s + a.amount, 0);
  // 1か月あたり
  const per = (n: number) => Math.round(n / months);
  return { revenue: per(revenue), expense: per(expense), costOfSales: per(costOfSales), accounts: list.map((a) => ({ ...a, amount: per(a.amount) })), booked: lines.length > 0, months };
}

export async function getPriceReview(companyId: string, now = new Date()) {
  const thisMonth = jstDateKey(now).slice(0, 7);
  const recentFrom = addMonths(thisMonth, -3);
  const recent = await periodTotals(companyId, recentFrom, thisMonth);
  let basis: "lastYear" | "previous" = "lastYear";
  let baseFrom = addMonths(recentFrom, -12);
  let base = await periodTotals(companyId, baseFrom, addMonths(thisMonth, -12));
  if (!base.booked || base.revenue <= 0) {
    basis = "previous";
    baseFrom = addMonths(recentFrom, -3);
    base = await periodTotals(companyId, baseFrom, recentFrom);
  }
  const period = { recent: { from: recentFrom, to: addMonths(thisMonth, -1) }, base: { from: baseFrom, to: addMonths(baseFrom, 2) }, basis };

  // 上がった費用(1か月あたり3,000円以上・5%以上)
  const costUps = recent.accounts
    .filter((a) => a.category === "EXPENSE" && !SKIP.has(a.code))
    .map((a) => {
      const before = base.accounts.find((b) => b.code === a.code)?.amount ?? 0;
      return { code: a.code, name: a.name, recent: a.amount, base: before, diff: a.amount - before, pct: pct(a.amount, before) };
    })
    .filter((a) => a.diff >= 3_000 && (a.pct === null || a.pct >= 5))
    .sort((a, b) => b.diff - a.diff)
    .slice(0, 8);

  const margin = (t: { revenue: number; expense: number }) => (t.revenue > 0 ? (t.revenue - t.expense) / t.revenue : null);
  const gross = (t: { revenue: number; costOfSales: number }) => (t.revenue > 0 ? (t.revenue - t.costOfSales) / t.revenue : null);
  const m0 = margin(base);
  const m1 = margin(recent);
  // 利益率を前と同じにするのに必要な売上 R' = 費用 / (1 − 前の利益率)
  let neededPct: number | null = null;
  if (m0 !== null && m1 !== null && m0 < 0.95 && recent.revenue > 0 && m1 < m0) {
    const needed = recent.expense / (1 - m0);
    neededPct = Math.min(50, Math.max(0, Math.round((needed / recent.revenue - 1) * 1000) / 10));
  }

  // 売値を長く変えていない品目(発行した請求書の明細、直近18か月)
  const lines = await prisma.invoiceLine.findMany({
    where: { invoice: { companyId, direction: "ISSUED", status: { notIn: ["DRAFT", "CANCELLED"] }, issueDate: { gte: monthStart(addMonths(thisMonth, -18)) } } },
    select: { description: true, unitPrice: true, quantity: true, amount: true, invoice: { select: { issueDate: true, customerId: true, customer: { select: { name: true } } } } },
    orderBy: { invoice: { issueDate: "asc" } },
  });
  const groups = new Map<string, { label: string; prices: { date: string; price: number }[]; customers: Set<string>; revenue12: number; count: number }>();
  const since12 = monthStart(addMonths(thisMonth, -12));
  for (const l of lines) {
    if (!l.invoice.issueDate || l.unitPrice <= 0) continue;
    const key = groupKey(l.description);
    const g = groups.get(key) ?? { label: "", prices: [], customers: new Set<string>(), revenue12: 0, count: 0 };
    // 表示名は「10月分」「2026年10月」などを除いたもの
    g.label = l.description.replace(/\s*(\d{2,4}年)?\d{1,2}月分?/g, "").trim() || l.description;
    g.prices.push({ date: jstDateKey(l.invoice.issueDate), price: l.unitPrice });
    if (l.invoice.customer?.name) g.customers.add(l.invoice.customer.name);
    if (l.invoice.issueDate >= since12) g.revenue12 += l.amount;
    g.count += 1;
    groups.set(key, g);
  }
  const today = jstDateKey(now);
  const items = [...groups.values()]
    .map((g) => {
      const last = g.prices[g.prices.length - 1];
      // 今の値段になった日(さかのぼって同じ値段が続いている最初の日)
      let since = last.date;
      for (let i = g.prices.length - 1; i >= 0 && g.prices[i].price === last.price; i--) since = g.prices[i].date;
      const months = Math.max(0, Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${since}T00:00:00Z`)) / (30.4 * 86_400_000)));
      const first = g.prices[0].price;
      return { label: g.label, price: last.price, since, months, firstPrice: first, changed: g.prices.some((p) => p.price !== last.price), customers: [...g.customers].slice(0, 5), revenue12: g.revenue12, count: g.count, lastDate: last.date };
    })
    .filter((x) => x.revenue12 > 0)
    .sort((a, b) => b.revenue12 - a.revenue12)
    .slice(0, 30);

  const findings: string[] = [];
  const label = basis === "lastYear" ? "前年の同じ時期" : "その前の3か月";
  if (m0 !== null && m1 !== null) findings.push(`利益率は${label}の ${Math.round(m0 * 1000) / 10}% から、直近3か月は ${Math.round(m1 * 1000) / 10}% に${m1 < m0 ? "下がっています" : m1 > m0 ? "上がっています" : "変わっていません"}。`);
  if (costUps.length) findings.push(`上がった費用: ${costUps.slice(0, 3).map((c) => `${c.name} +${formatYen(c.diff)}${c.pct !== null ? `(${c.pct}%)` : ""}`).join("、")}(1か月あたり、${label}と比べて)`);
  if (neededPct !== null && neededPct > 0) findings.push(`利益率を${label}と同じに戻すには、売る数が同じなら売値を平均で約 ${neededPct}% 上げる必要があります。`);
  const stale = items.filter((i) => !i.changed && i.months >= 12);
  if (stale.length) findings.push(`1年以上値段を変えていない品目: ${stale.slice(0, 3).map((i) => `「${i.label}」`).join("、")}${stale.length > 3 ? `ほか${stale.length - 3}件` : ""}`);
  if (!recent.booked) findings.push("直近3か月の記帳がないため、利益率を比べられません。");

  return {
    period,
    revenue: { recent: recent.revenue, base: base.revenue },
    expense: { recent: recent.expense, base: base.expense },
    margin: { recent: m1, base: m0 },
    grossMargin: { recent: gross(recent), base: gross(base) },
    costUps,
    neededPct,
    items,
    findings,
    monthly: { revenue: recent.revenue, costOfSales: recent.costOfSales, expense: recent.expense },
    bookedMonths: { recent: recent.months, base: base.months },
  };
}

export function parseRaise(input: { raisePct?: unknown; lossPct?: unknown }) {
  const raisePct = Number(input.raisePct ?? 5);
  const lossPct = Number(input.lossPct ?? 0);
  if (!Number.isFinite(raisePct) || raisePct <= 0 || raisePct > 100) throw new UserError("値上げの割合は0〜100%で入れてください");
  if (!Number.isFinite(lossPct) || lossPct < 0 || lossPct > 90) throw new UserError("お客さまが減る割合は0〜90%で入れてください");
  return { raisePct: Math.round(raisePct * 10) / 10, lossPct: Math.round(lossPct * 10) / 10 };
}

const jpDate = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return `${y}年${m}月${d}日`;
};

export function templateLetter(input: { companyName: string; today: string; effectiveDate: string; raisePct: number; reasons: string[]; items: { label: string; price: number }[] }) {
  const reason = input.reasons.length ? `${input.reasons.slice(0, 3).join("・")}などの上昇` : "原材料費・光熱費・物流費などの上昇";
  return [
    jpDate(input.today),
    "お取引先各位",
    input.companyName,
    "",
    "価格改定のお願い",
    "",
    "拝啓 時下ますますご清栄のこととお慶び申し上げます。平素は格別のお引き立てを賜り、厚く御礼申し上げます。",
    `さて、昨今の${reason}により、当社におきましても経費の削減に努めてまいりましたが、現在の価格を維持することが難しい状況となりました。`,
    `つきましては、誠に心苦しいお願いではございますが、${jpDate(input.effectiveDate)}ご注文分より、下記のとおり価格を改定させていただきたく、お願い申し上げます。`,
    "何卒事情をご賢察のうえ、ご理解を賜りますようお願い申し上げます。",
    "敬具",
    "",
    "記",
    `1. 改定の時期: ${jpDate(input.effectiveDate)}ご注文分より`,
    `2. 改定の内容: 現行価格より約${input.raisePct}%の改定`,
    ...input.items.slice(0, 20).map((i) => `   ・${i.label}: ${formatYen(i.price)} → ${formatYen(newPrice(i.price, input.raisePct))}`),
    "",
    "以上",
  ].join("\n");
}

// お知らせ文で取引先に伝える言い方(科目名のままでは伝わりにくいもの)
const REASON: Record<string, string> = { "5000": "原材料費・仕入価格", "5110": "人件費", "5120": "人件費", "5115": "人件費", "5070": "光熱費", "5060": "家賃", "5090": "外注費", "5030": "資材・消耗品費" };

const SCHEMA = {
  type: "object",
  properties: {
    advice: { type: "string", description: "値上げの進め方の見立て(2〜4文。どの品目から・どのくらい・いつ・どう伝えるか)" },
    letter: { type: "string", description: "取引先へのお知らせ文(日本のビジネス文書の形。日付・宛名・差出人・件名・本文・記・以上)" },
  },
  required: ["advice", "letter"],
  additionalProperties: false,
};

export async function draftPriceLetter(user: { id: string; companyId: string }, input: { raisePct?: unknown; lossPct?: unknown; effectiveDate?: unknown; items?: unknown; note?: unknown }) {
  const { raisePct } = parseRaise(input);
  const today = jstDateKey(new Date());
  const effectiveDate = String(input.effectiveDate ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate) || effectiveDate <= today) throw new UserError("改定の時期を明日以降の日付で入れてください");
  const note = String(input.note ?? "").trim().slice(0, 500);
  const [review, company] = await Promise.all([getPriceReview(user.companyId), prisma.company.findUnique({ where: { id: user.companyId }, select: { name: true } })]);
  const wanted = new Set((Array.isArray(input.items) ? input.items : []).map((x) => String(x)));
  const items = review.items.filter((i) => wanted.has(i.label)).map((i) => ({ label: i.label, price: i.price }));
  // 取引先に伝える理由は、原材料・人件費・光熱費など相手にも分かる費用だけ(広告費などは入れない)
  const reasons = [...new Set(review.costUps.filter((c) => REASON[c.code]).map((c) => REASON[c.code]))].slice(0, 3);
  const companyName = company?.name ?? "";
  let letter = templateLetter({ companyName, today, effectiveDate, raisePct, reasons, items });
  let advice: string | null = null;
  let mode: "claude" | "template" = "template";
  const ai = await aiFor(user.companyId);
  if (ai) {
    if ((await prisma.assistantLog.count({ where: { companyId: user.companyId, createdAt: { gte: new Date(`${today}T00:00:00+09:00`) } } })) >= DAILY_LIMIT) throw new UserError(`AIの利用は1日${DAILY_LIMIT}回までです。明日またお試しください`);
    try {
      const response = await ai.beta.messages.create({
        model: MODEL,
        max_tokens: 4000,
        system: [
          {
            type: "text",
            text: [
              "あなたは日本の小さな会社の経営者を助ける担当者です。値上げ(価格改定)の進め方の見立てと、取引先へのお知らせ文を書きます。",
              "お知らせ文は、ていねいな日本のビジネス文書の形(日付・宛名「お取引先各位」・差出人・件名・拝啓〜敬具・記・以上)で、改定の時期・割合・品目ごとの新旧の価格(渡したもの)を入れてください。理由は customerReasons(取引先に伝えてよい費用の上昇)から書き(空なら「原材料費・光熱費・物流費などの上昇」のような一般的な言い方にとどめ)、作った事実や数字は入れないでください。利用者のメモ(note)があれば反映してください。",
              "見立て(advice)は、利益率の変化・必要な値上げ幅・お客さまが減ったときの影響を踏まえて、どの品目から・どのくらい・いつ・どう伝えるかを短く書いてください。",
            ].join("\n"),
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [
          {
            role: "user",
            content: JSON.stringify({
              companyName,
              today,
              effectiveDate,
              raisePct,
              note: note || null,
              marginBefore: review.margin.base,
              marginRecent: review.margin.recent,
              neededPct: review.neededPct,
              costUps: review.costUps.map((c) => ({ name: c.name, increasePerMonth: c.diff, pct: c.pct })),
              customerReasons: reasons,
              items: items.map((i) => ({ name: i.label, currentPrice: i.price, newPrice: newPrice(i.price, raisePct) })),
              simulation: [0, 5, 10].map((loss) => simulatePriceIncrease(review.monthly, raisePct, loss)),
            }),
          },
        ],
        output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
      if (response.stop_reason !== "refusal" && response.stop_reason !== "max_tokens") {
        const raw = JSON.parse(
          response.content
            .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
            .map((b) => b.text)
            .join(""),
        ) as { advice?: unknown; letter?: unknown };
        const l = typeof raw.letter === "string" ? raw.letter.trim().slice(0, 4000) : "";
        const a = typeof raw.advice === "string" ? raw.advice.trim().slice(0, 600) : "";
        // 渡した数字(割合・価格・利益率・改定日)にない数字を書いた文は使わない
        const source = JSON.stringify({ letter, today, effectiveDate, raisePct, note, margin: review.margin, neededPct: review.neededPct, costUps: review.costUps, items: items.map((i) => ({ ...i, newPrice: newPrice(i.price, raisePct) })), simulation: [0, 5, 10].map((loss) => simulatePriceIncrease(review.monthly, raisePct, loss)) });
        if (l && !inventedNumbers(l, source).length) {
          letter = l;
          mode = "claude";
        }
        if (a && !inventedNumbers(a, source).length) advice = a;
      }
    } catch (error) {
      if (!(error instanceof Anthropic.APIError) && !(error instanceof SyntaxError)) throw error;
    }
    await prisma.assistantLog.create({ data: { companyId: user.companyId, userId: user.id, question: "値上げのお知らせ文", tools: [], mode: `price-${mode}` } });
  }
  return { letter, advice, mode, raisePct, effectiveDate, items: items.map((i) => ({ ...i, newPrice: newPrice(i.price, raisePct) })) };
}

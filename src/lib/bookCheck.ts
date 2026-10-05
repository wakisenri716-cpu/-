import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { formatYen } from "@/lib/format";
import { fiscalYearOf, getFiscalStartMonth } from "@/lib/accounting/period";
import { countDuplicates } from "@/lib/duplicates";

// 帳簿の健康診断: 税理士に渡す前に、今期の帳簿で間違いやすいところを決まったルールで点検する。
// ・10万円以上の消耗品(固定資産にすべきかも) ・金額の大きい雑費 ・現金がマイナスになった日
// ・残ったままの仮払金/配賦仮勘定 ・マイナスの預金/売掛金/預り金 ・私用に見える摘要 ・短すぎる摘要
// ・交際費の年800万円の枠 ・二重計上の疑い
// AIは見つかったものを読んで、どれから直すかを経営者向けにまとめる。

const MODEL = process.env.ANTHROPIC_ASSISTANT_MODEL || "claude-opus-5-5";
const DAILY_LIMIT = Number(process.env.ASSISTANT_DAILY_LIMIT || 100);
const POSTED = ["AUTO_POSTED", "POSTED_MANUALLY"] as const;
const DAY = 86_400_000;

export type FindingLevel = "warn" | "info";
export type Finding = { key: string; level: FindingLevel; title: string; detail: string; href: string; examples: { date: string; description: string; amount: number }[] };

async function accountIds(companyId: string) {
  const list = await prisma.account.findMany({ where: { companyId }, select: { id: true, code: true } });
  return new Map(list.map((a) => [a.code, a.id]));
}

export async function runBookCheck(companyId: string, today = jstDateKey(new Date())) {
  const fy = fiscalYearOf(today, await getFiscalStartMonth(companyId));
  const range = { gte: new Date(`${fy.from}T00:00:00Z`), lt: new Date(Date.parse(`${today}T00:00:00Z`) + DAY) };
  const [lines, ids, duplicates, entries] = await Promise.all([
    prisma.journalLine.findMany({
      where: { journalEntry: { companyId, status: { in: [...POSTED] }, date: range } },
      select: { debit: true, credit: true, account: { select: { code: true } }, journalEntry: { select: { id: true, date: true, description: true } } },
      orderBy: { journalEntry: { date: "asc" } },
    }),
    accountIds(companyId),
    countDuplicates(companyId),
    prisma.journalEntry.findMany({ where: { companyId, status: { in: [...POSTED] }, date: range }, select: { date: true, description: true, lines: { select: { debit: true } } } }),
  ]);
  const ledger = (code: string) => (ids.get(code) ? `/ledger?accountId=${ids.get(code)}` : "/journal");
  const ex = (l: (typeof lines)[number], amount = l.debit || l.credit) => ({ date: jstDateKey(l.journalEntry.date), description: l.journalEntry.description, amount });
  const findings: Finding[] = [];

  const capital = lines.filter((l) => l.account.code === "5030" && l.debit >= 100_000);
  if (capital.length)
    findings.push({
      key: "capitalize",
      level: "warn",
      title: `10万円以上の消耗品が ${capital.length}件 あります`,
      detail: "1つ10万円以上の物は、原則として固定資産にして減価償却します(中小企業は30万円未満なら一度に経費にできる特例があります)。内容を確かめてください。",
      href: ledger("5030"),
      examples: capital.slice(0, 5).map((l) => ex(l)),
    });

  const misc = lines.filter((l) => l.account.code === "5990" && l.debit >= 30_000);
  if (misc.length)
    findings.push({ key: "misc", level: "info", title: `金額の大きい雑費が ${misc.length}件 あります`, detail: "雑費は少額でほかに当てはまらないものに使う科目です。3万円以上は、より合う科目がないか見直しましょう。", href: ledger("5990"), examples: misc.slice(0, 5).map((l) => ex(l)) });

  // 現金の残高(期首までの残高から日ごとに足し引き)
  const cashId = ids.get("1010");
  if (cashId) {
    const opening = await prisma.journalLine.aggregate({ where: { accountId: cashId, journalEntry: { companyId, status: { in: [...POSTED] }, date: { lt: range.gte } } }, _sum: { debit: true, credit: true } });
    let bal = (opening._sum.debit ?? 0) - (opening._sum.credit ?? 0);
    const negative: { date: string; balance: number }[] = [];
    const byDay = new Map<string, number>();
    for (const l of lines.filter((l) => l.account.code === "1010")) byDay.set(jstDateKey(l.journalEntry.date), (byDay.get(jstDateKey(l.journalEntry.date)) ?? 0) + l.debit - l.credit);
    for (const [date, delta] of [...byDay].sort(([a], [b]) => a.localeCompare(b))) {
      bal += delta;
      if (bal < 0) negative.push({ date, balance: bal });
    }
    if (negative.length)
      findings.push({
        key: "cashNegative",
        level: "warn",
        title: `現金の残高がマイナスの日が ${negative.length}日 あります`,
        detail: `${negative[0].date} に ${formatYen(negative[0].balance)} になりました。現金はマイナスになりません。入金の記帳漏れか、預金から払ったものを現金にしていないか確かめてください。`,
        href: ledger("1010"),
        examples: negative.slice(0, 5).map((n) => ({ date: n.date, description: "その日の終わりの現金残高", amount: n.balance })),
      });
  }

  // 期末(今日)時点の残高
  const balanceOf = async (code: string) => {
    const id = ids.get(code);
    if (!id) return 0;
    const s = await prisma.journalLine.aggregate({ where: { accountId: id, journalEntry: { companyId, status: { in: [...POSTED] }, date: { lt: range.lt } } }, _sum: { debit: true, credit: true } });
    return (s._sum.debit ?? 0) - (s._sum.credit ?? 0);
  };
  const [suspense, allocation, bank, receivable, deposits] = await Promise.all(["1210", "1290", "1020", "1110", "2120"].map(balanceOf));
  if (suspense > 0)
    findings.push({ key: "suspense", level: "warn", title: `仮払金が ${formatYen(suspense)} 残っています`, detail: "仮払金は決算までに精算して、経費などの正しい科目に振り替えます。精算が終わっていないものを確かめてください。", href: "/advances", examples: [] });
  if (allocation !== 0)
    findings.push({ key: "allocation", level: "warn", title: `配賦仮勘定に ${formatYen(allocation)} 残っています`, detail: "部門配賦で使う一時的な科目です。配賦を実行して0にしてください。", href: "/allocations", examples: [] });
  if (bank < 0) findings.push({ key: "bankNegative", level: "warn", title: `普通預金の残高がマイナス(${formatYen(bank)})です`, detail: "通帳の残高と合っているか確かめてください。入金の記帳漏れが多い原因です。", href: ledger("1020"), examples: [] });
  if (receivable < 0) findings.push({ key: "arNegative", level: "warn", title: `売掛金の残高がマイナス(${formatYen(receivable)})です`, detail: "入金を二重に記帳したか、前受金にすべき入金かもしれません。", href: ledger("1110"), examples: [] });
  if (deposits > 0) findings.push({ key: "withholding", level: "warn", title: `預り金が借方に ${formatYen(deposits)} あります`, detail: "源泉所得税・住民税などを預かった額より多く納付したか、預かりの記帳が漏れています。", href: ledger("2120"), examples: [] });

  const personal = entries.filter((e) => /私用|個人的|家族|プライベート|自宅用/.test(e.description));
  if (personal.length)
    findings.push({
      key: "personal",
      level: "warn",
      title: `私用に見える摘要が ${personal.length}件 あります`,
      detail: "会社の経費にできるのは事業のための支出だけです。私用のものは役員への貸付金などにします。",
      href: "/journal",
      examples: personal.slice(0, 5).map((e) => ({ date: jstDateKey(e.date), description: e.description, amount: e.lines.reduce((s, l) => s + l.debit, 0) })),
    });

  const short = entries.filter((e) => e.description.trim().length < 3);
  if (short.length)
    findings.push({
      key: "shortDescription",
      level: "info",
      title: `摘要が短すぎる仕訳が ${short.length}件 あります`,
      detail: "あとから何の取引かわかるよう、相手・内容を書いておくと、税務調査や税理士の確認で困りません。",
      href: "/journal",
      examples: short.slice(0, 5).map((e) => ({ date: jstDateKey(e.date), description: e.description || "(空)", amount: e.lines.reduce((s, l) => s + l.debit, 0) })),
    });

  const entertainment = lines.filter((l) => l.account.code === "5050").reduce((s, l) => s + l.debit - l.credit, 0);
  if (entertainment > 8_000_000)
    findings.push({ key: "entertainment", level: "info", title: `交際費が年800万円の枠を超えています(${formatYen(entertainment)})`, detail: "中小法人は交際費のうち年800万円までが損金になります。1人5,000円以下(2024年4月以降は1万円以下)の飲食費は会議費にできる場合があります。", href: ledger("5050"), examples: [] });

  if (duplicates > 0) findings.push({ key: "duplicates", level: "warn", title: `二重計上かもしれないものが ${duplicates}組 あります`, detail: "同じレシート・同じ請求書番号・同じ日の同じ金額があります。", href: "/duplicates", examples: [] });

  const warns = findings.filter((f) => f.level === "warn").length;
  const infos = findings.length - warns;
  return { period: fy.from, periodLabel: `${fy.from}〜${today}`, findings, score: Math.max(0, 100 - warns * 12 - infos * 4), entryCount: entries.length };
}

export type BookCheckResult = Awaited<ReturnType<typeof runBookCheck>>;

const SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "帳簿の状態の一言(80字以内)" },
    priorities: {
      type: "array",
      description: "直す順番(最大5つ)",
      items: { type: "object", properties: { text: { type: "string" }, href: { type: "string" } }, required: ["text", "href"], additionalProperties: false },
    },
  },
  required: ["summary", "priorities"],
  additionalProperties: false,
} as const;

export function templateReview(r: BookCheckResult) {
  if (!r.findings.length) return { summary: "決まったルールで見る限り、気になるところは見つかりませんでした。", priorities: [] as { text: string; href: string }[] };
  const order = [...r.findings].sort((a, b) => (a.level === b.level ? 0 : a.level === "warn" ? -1 : 1));
  return {
    summary: `点検で ${r.findings.length}件 の気になるところが見つかりました(うち要注意 ${r.findings.filter((f) => f.level === "warn").length}件)。上から順に確かめましょう。`,
    priorities: order.slice(0, 5).map((f) => ({ text: f.title, href: f.href })),
  };
}

export async function reviewBooks(user: { id: string; name: string; companyId: string }) {
  const companyId = user.companyId;
  const since = new Date(`${jstDateKey(new Date())}T00:00:00+09:00`);
  if ((await prisma.assistantLog.count({ where: { companyId, createdAt: { gte: since } } })) >= DAILY_LIMIT) {
    throw new UserError(`AIの利用は1日${DAILY_LIMIT}回までです。明日またお試しください`);
  }
  const r = await runBookCheck(companyId);
  let result = templateReview(r);
  let mode = "template";
  if (process.env.ANTHROPIC_API_KEY && r.findings.length) {
    try {
      const allowed = new Set(r.findings.map((f) => f.href));
      const response = await new Anthropic().beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        system: [
          {
            type: "text",
            text: [
              "あなたは小さな会社の帳簿を点検する税理士事務所の担当者です。決まったルールで見つかった気になるところ(JSON)を読み、経営者にわかる言葉で帳簿の状態を一言でまとめ、直す順番を最大5つ書いてください。",
              "税金や決算への影響が大きいもの(固定資産にすべき物・私用の支出・マイナスの残高・二重計上)を先にしてください。text には何を確かめるかを具体的に、金額は「1,234円」の形で書いてください。",
              "href は各 finding の href だけを使ってください。見つかっていないことを推測で書かないでください。",
            ].join("\n"),
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [{ role: "user", content: JSON.stringify({ period: r.periodLabel, entryCount: r.entryCount, findings: r.findings }) }],
        output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
      if (response.stop_reason !== "refusal" && response.stop_reason !== "max_tokens") {
        const text = response.content
          .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
          .map((b) => b.text)
          .join("")
          .trim();
        const raw = JSON.parse(text) as { summary?: unknown; priorities?: unknown };
        const priorities = (Array.isArray(raw.priorities) ? raw.priorities : [])
          .map((p: { text?: unknown; href?: unknown }) => ({ text: String(p?.text ?? "").trim().slice(0, 200), href: allowed.has(String(p?.href)) ? String(p.href) : "/book-check" }))
          .filter((p) => p.text)
          .slice(0, 5);
        const summary = String(raw.summary ?? "").trim().slice(0, 160);
        if (summary) {
          result = { summary, priorities: priorities.length ? priorities : result.priorities };
          mode = "claude";
        }
      }
    } catch (error) {
      if (!(error instanceof Anthropic.APIError) && !(error instanceof SyntaxError)) throw error;
    }
  }
  await prisma.assistantLog.create({ data: { companyId, userId: user.id, question: `帳簿の健康診断 ${r.period}`, tools: [], mode: `book-${mode}` } });
  return prisma.bookCheck.upsert({
    where: { companyId_period: { companyId, period: r.period } },
    create: { companyId, period: r.period, score: r.score, ...result, mode, createdBy: user.name },
    update: { score: r.score, ...result, mode, createdBy: user.name, createdAt: new Date() },
  });
}

export async function getBookCheckReview(companyId: string, period: string) {
  return prisma.bookCheck.findUnique({ where: { companyId_period: { companyId, period } } });
}

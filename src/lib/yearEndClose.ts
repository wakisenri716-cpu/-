import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { aiFor } from "@/lib/ai/access";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { formatYen } from "@/lib/format";
import { fiscalYearOf, getFiscalStartMonth } from "@/lib/accounting/period";
import { getFixedAssetsWithSummary } from "@/lib/accounting/fixedAssets";
import { runBookCheck } from "@/lib/bookCheck";

// 決算の準備アシスト: 期末が近づいたら(過ぎたら)、決算までにやることを帳簿から確かめて順番に並べる。
// 自動で確かめられること(各月の締め・減価償却・棚卸・現金の実査・仮払金・消費税の決算整理・法人税等・帳簿の点検・期末の締め)と、
// 人が確かめてチェックすること(未払・未収の計上・前払費用・借入金の残高証明・在庫の評価など)を合わせて出し、AIが何から手を付けるかをまとめる。

const MODEL = process.env.ANTHROPIC_ASSISTANT_MODEL || "claude-opus-5-5";
const DAILY_LIMIT = Number(process.env.ASSISTANT_DAILY_LIMIT || 100);
const DAY = 86_400_000;
const NOTE_KIND = "YEAR_END_REVIEW";

export type YearEndItem = { key: string; label: string; kind: "auto" | "manual"; done: boolean; detail: string | null; href: string; checkedBy?: string | null };

const MANUAL_ITEMS = [
  { key: "accruals", label: "期末までの費用で、まだ請求書が来ていないもの(給料・社会保険料・水道光熱費・外注費など)を未払費用として計上した", href: "/journal" },
  { key: "receivableAccruals", label: "期末までに済んだ仕事で、まだ請求書を出していない売上を計上した", href: "/billing-gaps" },
  { key: "prepaid", label: "翌期分の家賃・保険料・保守料などを前払費用にした(期間按分)", href: "/allocations" },
  { key: "bankCertificates", label: "預金と借入金の期末残高を、通帳・残高証明書と合わせた", href: "/loans" },
  { key: "receivablesConfirmed", label: "売掛金・買掛金の期末残高を、取引先ごとに確かめた(回収できないものはないか)", href: "/receivables" },
  { key: "officerCompensation", label: "役員報酬・交際費など、税金の計算で調整が必要なものを確かめた", href: "/corporate-tax" },
] as const;

const addMonths = (month: string, n: number) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
};

// 対象の年度: 指定がなければ、期末から3か月以内なら前の年度、そうでなければ今の年度
export async function targetFiscalYear(companyId: string, yearInput?: unknown, today = jstDateKey(new Date())) {
  const startMonth = await getFiscalStartMonth(companyId);
  const current = fiscalYearOf(today, startMonth);
  const year = Number(yearInput);
  if (Number.isInteger(year) && year >= 2000 && year <= current.year) return fiscalYearOf(`${year}-${String(startMonth).padStart(2, "0")}-01`, startMonth);
  const prev = fiscalYearOf(`${current.year - 1}-${String(startMonth).padStart(2, "0")}-01`, startMonth);
  return Date.parse(`${today}T00:00:00Z`) - Date.parse(`${prev.to}T00:00:00Z`) <= 92 * DAY ? prev : current;
}

export async function getYearEndChecklist(companyId: string, yearInput?: unknown, today = jstDateKey(new Date())) {
  const fy = await targetFiscalYear(companyId, yearInput, today);
  const fromMonth = fy.from.slice(0, 7);
  const months = Array.from({ length: 12 }, (_, i) => addMonths(fromMonth, i));
  // 期の途中なら、今月(締められるのは先月)までを見る
  const lastMonth = fy.to < today ? fy.to.slice(0, 7) : addMonths(today.slice(0, 7), -1);
  const pastMonths = months.filter((m) => m <= lastMonth);
  const endMs = Date.parse(`${fy.to}T00:00:00Z`);
  const near = { gte: new Date(endMs - 14 * DAY), lt: new Date(endMs + 15 * DAY) };
  const [company, assets, products, stocktakes, cashCounts, advances, taxClose, corpTax, checks, book] = await Promise.all([
    prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { booksClosedThrough: true } }),
    getFixedAssetsWithSummary(companyId),
    prisma.product.count({ where: { companyId } }),
    prisma.stockMovement.count({ where: { product: { companyId }, type: "STOCKTAKE", date: near } }),
    prisma.cashCount.count({ where: { companyId, date: near } }),
    prisma.cashAdvance.findMany({ where: { companyId, status: "OPEN" }, select: { amount: true } }),
    prisma.consumptionTaxClose.findUnique({ where: { companyId_fiscalYear: { companyId, fiscalYear: fy.year } }, select: { id: true } }),
    prisma.corporateTaxRun.findUnique({ where: { companyId_fiscalYear: { companyId, fiscalYear: fy.year } }, select: { postedAt: true } }),
    prisma.monthlyCloseCheck.findMany({ where: { companyId, month: `FY${fy.year}` } }),
    runBookCheck(companyId, fy.to < today ? fy.to : today),
  ]);
  const closed = company.booksClosedThrough ? jstDateKey(company.booksClosedThrough) : null;
  const openMonths = pastMonths.filter((m) => !closed || closed < jstDateKey(new Date(Date.parse(`${addMonths(m, 1)}-01T00:00:00Z`) - DAY)));
  const missingDep = assets
    .filter((a) => !a.disposedAt && !a.fullyDepreciated)
    .flatMap((a) => pastMonths.filter((m) => a.acquisitionDate.toISOString().slice(0, 7) <= m && !a.depreciationEntries.some((e) => e.period === m)).map((m) => `${a.name}(${Number(m.slice(5))}月)`));
  const bookWarn = book.findings.filter((f) => f.level === "warn");
  const advanceTotal = advances.reduce((s, a) => s + a.amount, 0);
  const done = new Map(checks.map((c) => [c.key, c]));
  const ended = fy.to < today;

  const items: YearEndItem[] = [
    { key: "monthly", label: "各月の帳簿を締めた", kind: "auto", done: openMonths.length === 0, detail: openMonths.length ? `まだ締めていない月: ${openMonths.map((m) => `${Number(m.slice(5))}月`).join("・")}` : null, href: "/monthly-close" },
    { key: "depreciation", label: "固定資産の減価償却を、すべての月で計上した", kind: "auto", done: missingDep.length === 0, detail: missingDep.length ? `まだ計上していない月があります: ${missingDep.slice(0, 5).join("・")}${missingDep.length > 5 ? ` ほか${missingDep.length - 5}件` : ""}` : null, href: "/assets" },
    ...(products ? [{ key: "stocktake", label: "期末に在庫を数えた(棚卸)", kind: "auto" as const, done: stocktakes > 0, detail: stocktakes ? null : `期末(${fy.to})の前後2週間に棚卸の記録がありません`, href: "/inventory" }] : []),
    { key: "cashCount", label: "期末に現金を数えた(現金の実査)", kind: "auto", done: cashCounts > 0, detail: cashCounts ? null : `期末(${fy.to})の前後2週間に実査の記録がありません`, href: "/cash-count" },
    { key: "advances", label: "仮払金を精算した", kind: "auto", done: advances.length === 0, detail: advances.length ? `未精算の仮払金が ${advances.length}件(${formatYen(advanceTotal)})あります` : null, href: "/advances" },
    { key: "bookCheck", label: "帳簿の健康診断で要注意のところを直した", kind: "auto", done: bookWarn.length === 0, detail: bookWarn.length ? `要注意 ${bookWarn.length}件: ${bookWarn.slice(0, 3).map((f) => f.title).join("・")}` : null, href: "/book-check" },
    ...MANUAL_ITEMS.map((m) => {
      const c = done.get(m.key);
      return { key: m.key, label: m.label, kind: "manual" as const, done: !!c, detail: null, href: m.href, checkedBy: c ? `${c.checkedBy}(${jstDateKey(c.checkedAt)})` : null };
    }),
    { key: "consumptionTax", label: "消費税の決算整理(仮受・仮払消費税の相殺と未払消費税の計上)をした", kind: "auto", done: !!taxClose, detail: taxClose ? null : ended ? "まだ計上していません" : "期末が過ぎてから計上します", href: "/tax/close" },
    { key: "corporateTax", label: "法人税等を計算して計上した", kind: "auto", done: !!corpTax?.postedAt, detail: corpTax?.postedAt ? null : corpTax ? "計算はしましたが、まだ計上していません" : ended ? "まだ計算していません(消費税の決算整理の後に行います)" : "期末が過ぎてから計算します", href: `/corporate-tax?year=${fy.year}` },
    { key: "closed", label: "期末まで帳簿を締めた", kind: "auto", done: !!closed && closed >= fy.to, detail: closed && closed >= fy.to ? null : "すべて済んだら、期末の日付まで締めてください(締めた期間の仕訳は変更できなくなります)", href: "/closing" },
  ];
  const left = items.filter((i) => !i.done).length;
  // 法人税の申告期限: 期末の翌日から2か月(延長の届出がなければ)
  const deadline = new Date(Date.UTC(Number(fy.to.slice(0, 4)), Number(fy.to.slice(5, 7)) + 2, 0)).toISOString().slice(0, 10);
  return { fiscalYear: fy.year, from: fy.from, to: fy.to, ended, deadlinePassed: deadline < today, daysToEnd: Math.round((endMs - Date.parse(`${today}T00:00:00Z`)) / DAY), filingDeadline: deadline, items, left, total: items.length };
}

export async function setYearEndCheck(user: { name: string; companyId: string }, yearInput: unknown, key: string, checked: boolean) {
  if (!MANUAL_ITEMS.some((m) => m.key === key)) throw new UserError("この項目は自動で確かめます");
  const fy = await targetFiscalYear(user.companyId, yearInput);
  const month = `FY${fy.year}`;
  if (checked) {
    await prisma.monthlyCloseCheck.upsert({ where: { companyId_month_key: { companyId: user.companyId, month, key } }, create: { companyId: user.companyId, month, key, checkedBy: user.name }, update: {} });
  } else {
    await prisma.monthlyCloseCheck.deleteMany({ where: { companyId: user.companyId, month, key } });
  }
  return getYearEndChecklist(user.companyId, fy.year);
}

const SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "決算の準備の見立て(100字以内)" },
    steps: { type: "array", items: { type: "string" }, description: "これからやる順番(最大5つ、短く)" },
  },
  required: ["summary", "steps"],
  additionalProperties: false,
} as const;

export async function reviewYearEnd(user: { id: string; name: string; companyId: string }, yearInput?: unknown) {
  const companyId = user.companyId;
  const c = await getYearEndChecklist(companyId, yearInput);
  const open = c.items.filter((i) => !i.done);
  let result = {
    summary: open.length ? `決算までに残っている作業が ${open.length}件 あります(全${c.total}件)。${c.deadlinePassed ? `申告の期限(${c.filingDeadline})を過ぎています。税理士に相談してください。` : c.ended ? `申告の期限は ${c.filingDeadline} です。` : `期末まであと${c.daysToEnd}日です。`}` : "決算の準備はすべて済んでいます。",
    steps: open.slice(0, 5).map((i) => `${i.label}${i.detail ? `(${i.detail})` : ""}`),
  };
  let mode = "template";
  const ai = await aiFor(companyId);
  if (ai && open.length) {
    const today = jstDateKey(new Date());
    if ((await prisma.assistantLog.count({ where: { companyId, createdAt: { gte: new Date(`${today}T00:00:00+09:00`) } } })) >= DAILY_LIMIT) throw new UserError(`AIの利用は1日${DAILY_LIMIT}回までです。明日またお試しください`);
    try {
      const response = await ai.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        system: [
          {
            type: "text",
            text: [
              "あなたは小さな会社の決算を手伝う経理担当者です。決算の準備のチェックリスト(JSON)を読み、残っている作業を、決算の手順として正しい順番に並べ、経営者向けに見立てを書いてください。",
              "ふつうは、各月の締め・減価償却・棚卸・現金の実査・仮払金・未払/未収/前払の計上 → 帳簿の点検 → 消費税の決算整理 → 法人税等の計算・計上 → 期末の締め の順です。期末前なら、期末までにできる準備を先にしてください。",
              "申告期限(filingDeadline)が近ければ触れてください。データにないことは推測しないでください。税務の判断は税理士への確認をすすめてください。",
            ].join("\n"),
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [{ role: "user", content: JSON.stringify({ today, fiscalYear: `${c.from}〜${c.to}`, ended: c.ended, daysToEnd: c.daysToEnd, filingDeadline: c.filingDeadline, filingDeadlinePassed: c.deadlinePassed, items: c.items.map((i) => ({ label: i.label, done: i.done, detail: i.detail })) }) }],
        output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
      if (response.stop_reason !== "refusal" && response.stop_reason !== "max_tokens") {
        const raw = JSON.parse(
          response.content
            .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
            .map((b) => b.text)
            .join("")
            .trim(),
        ) as { summary?: unknown; steps?: unknown };
        const summary = String(raw.summary ?? "").trim().slice(0, 200);
        const steps = (Array.isArray(raw.steps) ? raw.steps : []).map((s) => String(s).trim().slice(0, 160)).filter(Boolean).slice(0, 5);
        if (summary) {
          result = { summary, steps: steps.length ? steps : result.steps };
          mode = "claude";
        }
      }
    } catch (error) {
      if (!(error instanceof Anthropic.APIError) && !(error instanceof SyntaxError)) throw error;
    }
    await prisma.assistantLog.create({ data: { companyId, userId: user.id, question: `決算の準備 ${c.fiscalYear}`, tools: [], mode: `yearend-${mode}` } });
  }
  const key = String(c.fiscalYear);
  return prisma.aiNote.upsert({
    where: { companyId_kind_key: { companyId, kind: NOTE_KIND, key } },
    create: { companyId, kind: NOTE_KIND, key, data: result, mode, createdBy: user.name },
    update: { data: result, mode, createdBy: user.name, createdAt: new Date() },
  });
}

export async function getYearEndReview(companyId: string, fiscalYear: number) {
  return prisma.aiNote.findUnique({ where: { companyId_kind_key: { companyId, kind: NOTE_KIND, key: String(fiscalYear) } } });
}

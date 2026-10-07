import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { aiFor } from "@/lib/ai/access";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { audit } from "@/lib/audit";
import { formatYen } from "@/lib/format";
import { fiscalYearOf, getFiscalStartMonth } from "@/lib/accounting/period";

// 交際費の管理: 今期の接待交際費(5050)の使い方を、中小法人の損金の上限(年800万円)と比べる。
// 1人あたり1万円以下の飲食費は、相手・人数などを記録しておけば交際費から除ける(会議費などとして扱える)ので、
// 明細ごとに「種類・人数・相手・目的」を記録できるようにし、記録が足りないものを知らせる。
// 上限・基準は一般的な目安(資本金1億円以下の会社)。判断に迷うときは税理士に確かめる前提。

const MODEL = process.env.ANTHROPIC_ASSISTANT_MODEL || "claude-opus-5-5";
const DAILY_LIMIT = Number(process.env.ASSISTANT_DAILY_LIMIT || 100);
const ENTERTAINMENT = "5050";
const CAPITAL = "3010";
const POSTED = ["AUTO_POSTED", "POSTED_MANUALLY"] as const;
export const ANNUAL_LIMIT = 8_000_000;
export const MEAL_PER_PERSON = 10_000;

export type EntertainmentKind = "MEAL" | "GIFT" | "OTHER";
export const KIND_LABEL: Record<EntertainmentKind, string> = { MEAL: "飲食", GIFT: "贈答", OTHER: "その他" };

const MEAL = /飲食|食事|会食|懇親|居酒屋|レストラン|ランチ|ディナー|寿司|鮨|焼肉|焼き肉|料亭|カフェ|喫茶|バー|酒|ビール|弁当|宴会|食堂|ホテル.*(食|宴)/;
const GIFT = /贈答|お歳暮|御歳暮|お中元|御中元|手土産|土産|花|祝|香典|弔|ギフト|商品券|贈り物|のし/;

// 飲食ではない接待(ゴルフ・観劇・旅行など)
const NOT_MEAL = /ゴルフ|観劇|旅行|チケット|コンサート|観戦|スポーツ|宿泊/;

export function guessKind(text: string): EntertainmentKind {
  if (GIFT.test(text)) return "GIFT";
  if (NOT_MEAL.test(text)) return "OTHER";
  if (MEAL.test(text)) return "MEAL";
  return "OTHER";
}
// 摘要の「3名」「4人」から人数を読む
export function guessPersons(text: string) {
  const m = text.match(/(\d{1,3})\s*(?:名|人)/);
  const n = m ? Number(m[1]) : NaN;
  return Number.isInteger(n) && n > 0 && n < 1000 ? n : null;
}

export type EntertainmentRow = {
  lineId: string;
  date: string;
  description: string;
  amount: number;
  kind: EntertainmentKind;
  persons: number | null;
  guests: string | null;
  purpose: string | null;
  recorded: boolean; // 記録を入れたもの(推定ではない)
  perPerson: number | null;
  underLimit: boolean; // 1人あたり1万円以下の飲食費(記録がそろっているもの)
  missing: string[]; // 足りない記録
};

export async function getEntertainment(companyId: string, today = jstDateKey(new Date())) {
  const startMonth = await getFiscalStartMonth(companyId);
  const fy = fiscalYearOf(today, startMonth);
  const [lines, capitalLines] = await Promise.all([
    prisma.journalLine.findMany({
      where: { account: { companyId, code: ENTERTAINMENT }, journalEntry: { companyId, status: { in: [...POSTED] }, date: { gte: new Date(`${fy.from}T00:00:00Z`), lt: new Date(Date.parse(`${fy.to}T00:00:00Z`) + 86_400_000) } } },
      select: { id: true, debit: true, credit: true, memo: true, journalEntry: { select: { date: true, description: true } } },
      orderBy: [{ journalEntry: { date: "asc" } }, { id: "asc" }],
    }),
    prisma.journalLine.findMany({ where: { account: { companyId, code: CAPITAL }, journalEntry: { companyId, status: { in: [...POSTED] } } }, select: { debit: true, credit: true } }),
  ]);
  const records = await prisma.entertainmentRecord.findMany({ where: { companyId, journalLineId: { in: lines.map((l) => l.id) } } });
  const capital = capitalLines.reduce((s, l) => s + l.credit - l.debit, 0);
  const small = capital <= 100_000_000;

  const rows: EntertainmentRow[] = lines
    .map((l) => {
      const text = [l.journalEntry.description, l.memo].filter(Boolean).join(" ");
      const r = records.find((x) => x.journalLineId === l.id);
      const amount = l.debit - l.credit;
      const kind = (r?.kind as EntertainmentKind) ?? guessKind(text);
      const persons = r ? r.persons : guessPersons(text);
      const guests = r?.guests ?? null;
      const perPerson = kind === "MEAL" && persons ? Math.round(amount / persons) : null;
      const missing: string[] = [];
      if (kind === "MEAL") {
        if (!persons) missing.push("人数");
        if (!guests) missing.push("相手");
      } else if (!guests) missing.push("相手");
      return {
        lineId: l.id,
        date: jstDateKey(l.journalEntry.date),
        description: text.slice(0, 120),
        amount,
        kind,
        persons,
        guests,
        purpose: r?.purpose ?? null,
        recorded: !!r,
        perPerson,
        // 1万円以下の基準は、相手・人数などを書いておくことが条件
        underLimit: kind === "MEAL" && perPerson !== null && perPerson <= MEAL_PER_PERSON && amount > 0 && missing.length === 0,
        missing,
      };
    })
    .filter((r) => r.amount !== 0);

  const used = rows.reduce((s, r) => s + r.amount, 0);
  const excludable = rows.filter((r) => r.underLimit).reduce((s, r) => s + r.amount, 0);
  const counted = used - excludable;
  // 期首から今日までの月数(今月を含む)
  const elapsed = Math.min(12, Math.max(1, (Number(today.slice(0, 4)) - Number(fy.from.slice(0, 4))) * 12 + Number(today.slice(5, 7)) - Number(fy.from.slice(5, 7)) + 1));
  const forecast = Math.round((counted / elapsed) * 12);
  const meals = rows.filter((r) => r.kind === "MEAL");
  const candidates = meals.filter((r) => !r.underLimit && r.missing.length > 0 && (r.perPerson === null || r.perPerson <= MEAL_PER_PERSON));
  const findings: string[] = [];
  if (!rows.length) findings.push("今期の接待交際費はまだありません。");
  else {
    findings.push(`今期(${fy.from.replaceAll("-", "/")}〜)の接待交際費は ${formatYen(used)}(${rows.length}件)です。${excludable ? `うち1人1万円以下の飲食費 ${formatYen(excludable)} は交際費から除けます。` : ""}`);
    if (small) {
      findings.push(
        forecast > ANNUAL_LIMIT
          ? `このペースだと1年で約 ${formatYen(forecast)} になり、損金にできる上限(年800万円)を超えそうです。超えた分は税金の計算で費用になりません。`
          : `このペースだと1年で約 ${formatYen(forecast)} で、損金にできる上限(年800万円)の範囲に収まりそうです。`,
      );
    } else findings.push("資本金が1億円を超えるため、800万円の枠は使えません(飲食費の50%だけが損金になります)。税理士に確かめてください。");
    if (candidates.length) findings.push(`記録(人数・相手)が足りない飲食費が${candidates.length}件あります。1人1万円以下なら、記録を入れると交際費から除けます。`);
  }
  return { fy: { from: fy.from, to: fy.to }, today, small, capital, used, excludable, counted, forecast, limit: small ? ANNUAL_LIMIT : null, elapsed, rows, findings };
}

export async function saveEntertainmentRecord(user: { companyId: string; name: string }, input: { lineId?: unknown; kind?: unknown; persons?: unknown; guests?: unknown; purpose?: unknown }) {
  const lineId = String(input.lineId ?? "");
  const line = await prisma.journalLine.findFirst({ where: { id: lineId, account: { companyId: user.companyId, code: ENTERTAINMENT }, journalEntry: { companyId: user.companyId } }, select: { id: true, journalEntry: { select: { description: true } } } });
  if (!line) throw new UserError("交際費の明細が見つかりません");
  const kind = String(input.kind ?? "MEAL");
  if (!Object.hasOwn(KIND_LABEL, kind)) throw new UserError("種類を選んでください");
  const personsRaw = input.persons === undefined || input.persons === null || input.persons === "" ? null : Number(input.persons);
  if (personsRaw !== null && (!Number.isInteger(personsRaw) || personsRaw < 1 || personsRaw > 999)) throw new UserError("人数を正しく入れてください");
  const guests = String(input.guests ?? "").replace(/[\r\n]/g, " ").trim().slice(0, 200) || null;
  const purpose = String(input.purpose ?? "").replace(/[\r\n]/g, " ").trim().slice(0, 200) || null;
  const data = { kind, persons: personsRaw, guests, purpose, byName: user.name.slice(0, 60) };
  await prisma.entertainmentRecord.upsert({ where: { journalLineId: lineId }, update: data, create: { ...data, companyId: user.companyId, journalLineId: lineId } });
  await audit("交際費の記録", `${line.journalEntry.description.slice(0, 40)}: ${KIND_LABEL[kind as EntertainmentKind]}${personsRaw ? `・${personsRaw}人` : ""}${guests ? `・${guests}` : ""}`);
  return { ok: true };
}

// ---- 見立て ----

export type EntertainmentAdvice = { summary: string; tips: string[]; mode: "claude" | "template" };

export function templateAdvice(d: Awaited<ReturnType<typeof getEntertainment>>): Omit<EntertainmentAdvice, "mode"> {
  const tips: string[] = [];
  const missing = d.rows.filter((r) => r.missing.length);
  if (missing.length) tips.push(`記録が足りない明細が${missing.length}件あります。日付・相手(会社名・氏名・関係)・人数・お店を記録しておくと、税務調査でも説明できます。`);
  const nearLimit = d.rows.filter((r) => r.kind === "MEAL" && r.perPerson !== null && r.perPerson > MEAL_PER_PERSON && r.perPerson <= MEAL_PER_PERSON * 1.2);
  if (nearLimit.length) tips.push(`1人あたりが1万円を少し超えた飲食が${nearLimit.length}件あります(人数の数え漏れがないか確かめてください)。`);
  const insiders = d.rows.filter((r) => r.guests && /社内|社員|従業員|スタッフ/.test(r.guests));
  if (insiders.length) tips.push("社内の人だけの飲食は、1人1万円以下の基準の対象外です(福利厚生費や会議費になるかは内容しだいです)。");
  if (d.limit && d.forecast > d.limit) tips.push("上限を超えそうなときは、1人1万円以下に収める・会議に伴う飲み物や弁当は会議費にする、などの見直しを考えましょう。");
  if (!tips.length) tips.push("記録はそろっています。このまま、使ったらすぐ相手・人数を記録する習慣を続けましょう。");
  return { summary: d.findings.join(""), tips };
}

const SCHEMA = {
  type: "object",
  properties: { summary: { type: "string", description: "2〜3文のまとめ" }, tips: { type: "array", items: { type: "string" }, description: "次にやること(4つまで)" } },
  required: ["summary", "tips"],
  additionalProperties: false,
};

export async function adviseEntertainment(user: { id: string; companyId: string }) {
  const d = await getEntertainment(user.companyId);
  const base = templateAdvice(d);
  const ai = await aiFor(user.companyId);
  if (!ai || !d.rows.length) return { ...base, mode: "template" as const };
  const today = jstDateKey(new Date());
  if ((await prisma.assistantLog.count({ where: { companyId: user.companyId, createdAt: { gte: new Date(`${today}T00:00:00+09:00`) } } })) >= DAILY_LIMIT) throw new UserError(`AIの利用は1日${DAILY_LIMIT}回までです。明日またお試しください`);
  let result: EntertainmentAdvice = { ...base, mode: "template" };
  try {
    const response = await ai.beta.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: [
        {
          type: "text",
          text: [
            "あなたは小さな会社の経理を手伝う担当者です。今期の接待交際費の使い方(合計・1人1万円以下として除ける額・1年のペース・上限・明細ごとの種類・人数・相手・足りない記録)を読み、社長向けに短くまとめ、次にやることを書いてください。",
            "渡した数字と明細だけを使い、税額や法令の条文番号など渡していないことは書かないでください。判断が分かれるものは「税理士に確かめる」としてください。",
          ].join("\n"),
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            period: `${d.fy.from}〜${d.fy.to}`,
            used: d.used,
            excludableUnder10k: d.excludable,
            counted: d.counted,
            forecastYear: d.forecast,
            limit: d.limit,
            rows: d.rows.slice(0, 60).map((r) => ({ date: r.date, description: r.description, amount: r.amount, kind: KIND_LABEL[r.kind], persons: r.persons, guests: r.guests, perPerson: r.perPerson, missing: r.missing })),
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
      ) as { summary?: unknown; tips?: unknown };
      const summary = typeof raw.summary === "string" ? raw.summary.trim().slice(0, 400) : "";
      const tips = (Array.isArray(raw.tips) ? raw.tips : []).filter((t): t is string => typeof t === "string" && !!t.trim()).map((t) => t.trim().slice(0, 200)).slice(0, 4);
      if (summary) result = { summary, tips: tips.length ? tips : base.tips, mode: "claude" };
    }
  } catch (error) {
    if (!(error instanceof Anthropic.APIError) && !(error instanceof SyntaxError)) throw error;
  }
  await prisma.assistantLog.create({ data: { companyId: user.companyId, userId: user.id, question: "交際費の見立て", tools: [], mode: `entertainment-${result.mode}` } });
  return result;
}

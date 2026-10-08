import Anthropic from "@anthropic-ai/sdk";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { aiFor } from "@/lib/ai/access";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { inventedNumbers } from "@/lib/ai/numberGuard";

// 見積のフォロー: 出したまま返事を待っている見積書(提出済み)を、送ってからの日数・有効期限までの日数・追いかけたメールの回数から並べ、
// 「送っていない」「返事待ち」「追いかけどき」「期限まぢか」「期限切れ」に分ける。追いかけのメールの下書き(ひな形・AI)を作り、
// 送る(見積書のメール送信と同じ記録)・有効期限を延ばす・取り消す(失注)ができる。

const MODEL = process.env.ANTHROPIC_ASSISTANT_MODEL || "claude-opus-5-5";
const DAILY_LIMIT = Number(process.env.ASSISTANT_DAILY_LIMIT || 100);
const DAY = 86_400_000;
const FOLLOW_AFTER = 7; // 送ってから(前に追いかけてから)何日で追いかけるか
const EXPIRING = 7; // 有効期限まで何日で「期限まぢか」か

export type FollowStage = "UNSENT" | "WAIT" | "FOLLOW" | "EXPIRING" | "EXPIRED";
export const STAGE_LABEL: Record<FollowStage, { label: string; action: string }> = {
  UNSENT: { label: "まだ送っていない", action: "見積書を送る" },
  WAIT: { label: "返事待ち", action: "もう少し待つ" },
  FOLLOW: { label: "追いかけどき", action: "ご検討の状況をうかがう" },
  EXPIRING: { label: "期限まぢか", action: "期限が近いことを伝える" },
  EXPIRED: { label: "期限切れ", action: "期限を延ばすか、取り消す" },
};

const key = (d: Date) => d.toISOString().slice(0, 10);
const jp = (k: string) => `${Number(k.slice(5, 7))}月${Number(k.slice(8, 10))}日`;
const yen = (n: number) => `${n.toLocaleString("ja-JP")}円`;

export async function getFollowups(companyId: string, today = jstDateKey(new Date())) {
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  const quotes = await prisma.quote.findMany({ where: { companyId, status: "OPEN" }, include: { customer: { select: { id: true, name: true, email: true, contactName: true } } }, orderBy: { validUntil: "asc" }, take: 300 });
  const logs = await prisma.emailLog.findMany({ where: { companyId, kind: "QUOTE", status: { not: "FAILED" }, relatedId: { in: quotes.map((q) => q.id) } }, select: { relatedId: true, createdAt: true }, orderBy: { createdAt: "asc" } });
  const rows = quotes.map((q) => {
    const mails = logs.filter((l) => l.relatedId === q.id);
    const sentAt = mails[0] ? jstDateKey(mails[0].createdAt) : null;
    const lastAt = mails.length ? jstDateKey(mails[mails.length - 1].createdAt) : null;
    const daysSinceIssue = Math.round((todayMs - Date.parse(`${key(q.issueDate)}T00:00:00Z`)) / DAY);
    const daysSinceLast = lastAt ? Math.round((todayMs - Date.parse(`${lastAt}T00:00:00Z`)) / DAY) : null;
    const daysLeft = Math.round((Date.parse(`${key(q.validUntil)}T00:00:00Z`) - todayMs) / DAY);
    const stage: FollowStage =
      daysLeft < 0 ? "EXPIRED" : daysLeft <= EXPIRING && (daysSinceLast === null || daysSinceLast >= 3) ? "EXPIRING" : !sentAt ? "UNSENT" : daysSinceLast! >= FOLLOW_AFTER ? "FOLLOW" : "WAIT";
    return {
      id: q.id,
      quoteNumber: q.quoteNumber,
      customer: q.customer,
      issueDate: key(q.issueDate),
      validUntil: key(q.validUntil),
      total: q.totalAmount,
      sentAt,
      lastMailAt: lastAt,
      followups: Math.max(0, mails.length - 1),
      daysSinceIssue,
      daysLeft,
      stage,
    };
  });
  const order: FollowStage[] = ["EXPIRING", "FOLLOW", "UNSENT", "EXPIRED", "WAIT"];
  rows.sort((a, b) => order.indexOf(a.stage) - order.indexOf(b.stage) || a.daysLeft - b.daysLeft);
  return { today, rows, totalOpen: rows.reduce((s, r) => s + r.total, 0), needAction: rows.filter((r) => r.stage === "FOLLOW" || r.stage === "EXPIRING").length };
}

export type FollowRow = Awaited<ReturnType<typeof getFollowups>>["rows"][number];

// やることリスト: 追いかけどき・期限まぢかの見積
export async function countQuoteFollowups(companyId: string) {
  return (await getFollowups(companyId)).needAction;
}

async function shareLink(companyId: string, id: string, baseUrl: string) {
  const q = await prisma.quote.findFirst({ where: { id, companyId }, select: { shareToken: true } });
  if (!q) throw new UserError("見積書が見つかりません");
  const token = q.shareToken ?? randomBytes(24).toString("base64url");
  if (!q.shareToken) await prisma.quote.update({ where: { id }, data: { shareToken: token } });
  return `${baseUrl}/share/quote/${token}`;
}

export function templateFollowMail(r: FollowRow, company: { name: string; address: string | null; phone: string | null; email: string | null }, sender: string, link: string) {
  const to = [`${r.customer.name} 御中`, r.customer.contactName ? `${r.customer.contactName} 様` : null].filter(Boolean).join("\n");
  const head = `いつもお世話になっております。${company.name}の${sender}です。`;
  const what = `${jp(r.issueDate)}にお送りしたお見積書(No.${r.quoteNumber}、お見積金額 ${yen(r.total)})`;
  let subject = `【ご確認】お見積書 ${r.quoteNumber} について`;
  let body: string[];
  if (r.stage === "UNSENT") {
    subject = `【お見積書】${r.quoteNumber} ${company.name}`;
    body = [`ご依頼いただきましたお見積書(No.${r.quoteNumber}、お見積金額 ${yen(r.total)})をお送りします。下記のリンクからご確認ください。`, `有効期限は${jp(r.validUntil)}です。`];
  } else if (r.stage === "EXPIRED") {
    subject = `【ご案内】お見積書 ${r.quoteNumber} の有効期限について`;
    body = [`${what}は、${jp(r.validUntil)}で有効期限を過ぎました。`, "引き続きご検討いただける場合は、あらためて同じ内容でお見積書をお出しいたしますので、お気軽にお申し付けください。"];
  } else if (r.stage === "EXPIRING") {
    body = [`${what}の有効期限が${jp(r.validUntil)}となっております。`, "ご検討の状況はいかがでしょうか。内容の変更やご不明な点がございましたら、お気軽にお知らせください。"];
  } else {
    body = [`${what}について、その後ご検討の状況はいかがでしょうか。`, "数量や仕様の変更、納期のご相談などがございましたら、内容を見直してお出しいたします。"];
  }
  const signature = ["--", company.name, sender, company.address, company.phone ? `TEL: ${company.phone}` : null, company.email ? `Mail: ${company.email}` : null].filter(Boolean) as string[];
  return {
    to: r.customer.email ?? "",
    subject,
    body: [to, "", head, "", ...body, "", "▼お見積書を見る(印刷・PDF保存できます)", link, "", "引き続きよろしくお願いいたします。", "", ...signature].join("\n"),
  };
}

const SCHEMA = {
  type: "object",
  properties: { paragraphs: { type: "array", items: { type: "string" }, description: "用件の段落(2〜4つ)。宛名・あいさつ・リンク・結び・署名は入れない" } },
  required: ["paragraphs"],
  additionalProperties: false,
} as const;


export async function draftFollowMail(user: { id: string; companyId: string; name: string }, id: string, raw: { notes?: unknown; useAi?: unknown; sender?: unknown }, baseUrl: string) {
  const { rows } = await getFollowups(user.companyId);
  const r = rows.find((x) => x.id === id);
  if (!r) throw new UserError("返事待ちの見積書が見つかりません(請求済み・取消のものは追いかけられません)");
  const company = await prisma.company.findUniqueOrThrow({ where: { id: user.companyId }, select: { name: true, address: true, phone: true, email: true } });
  const sender = String(raw.sender ?? "").trim().slice(0, 40) || user.name;
  const link = await shareLink(user.companyId, id, baseUrl);
  const base = templateFollowMail(r, company, sender, link);
  if (raw.useAi !== true) return { ...base, mode: "template" as const, stage: r.stage };

  const ai = await aiFor(user.companyId);
  if (!ai) throw new UserError("AIが使えません(AIの設定を確かめてください)");
  const today = jstDateKey(new Date());
  if ((await prisma.assistantLog.count({ where: { companyId: user.companyId, createdAt: { gte: new Date(`${today}T00:00:00+09:00`) } } })) >= DAILY_LIMIT) throw new UserError(`AIの利用は1日${DAILY_LIMIT}回までです。明日またお試しください`);
  const notes = String(raw.notes ?? "").trim().slice(0, 600);
  const [pre, post] = base.body.split("\n\n▼");
  const headLines = pre.split("\n\n");
  const templateParas = headLines.slice(2);
  let result = { ...base, mode: "template" as "claude" | "template", stage: r.stage };
  try {
    const response = await ai.beta.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: [
        {
          type: "text",
          text: [
            "あなたは小さな会社の営業事務です。出した見積書の返事をうかがうメールの、用件の段落を書きます。押しつけがましくなく、相手が返事をしやすいように、ていねいで簡潔に書いてください。",
            "金額・日付・見積番号は、渡した見積の情報(quote)とひな形(template)にあるものだけを使い、値引きや新しい約束は担当者のメモ(notes)にあるときだけ書いてください。",
          ].join("\n"),
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: JSON.stringify({ quote: { number: r.quoteNumber, customer: r.customer.name, total: r.total, issueDate: r.issueDate, validUntil: r.validUntil, stage: STAGE_LABEL[r.stage].label, followups: r.followups }, template: templateParas, notes: notes || null }) }],
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    if (response.stop_reason !== "refusal" && response.stop_reason !== "max_tokens") {
      const p = JSON.parse(
        response.content
          .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
          .map((b) => b.text)
          .join(""),
      ) as { paragraphs?: unknown };
      const paras = (Array.isArray(p.paragraphs) ? p.paragraphs : []).filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim().slice(0, 400)).slice(0, 5);
      const source = [templateParas.join(" "), notes, r.quoteNumber, `${r.total}円`, r.issueDate, r.validUntil].join(" ");
      if (paras.length && !inventedNumbers(paras.join(" "), source).length) {
        result = { ...base, body: [...headLines.slice(0, 2), ...paras].join("\n\n") + `\n\n▼${post}`, mode: "claude", stage: r.stage };
      }
    }
  } catch (error) {
    if (!(error instanceof Anthropic.APIError) && !(error instanceof SyntaxError)) throw error;
  }
  await prisma.assistantLog.create({ data: { companyId: user.companyId, userId: user.id, question: `見積のフォロー ${r.quoteNumber}`, tools: [], mode: `qfollow-${result.mode}` } });
  return result;
}

// 有効期限を延ばす(今日から days 日後まで)
export async function extendQuote(companyId: string, id: string, days: unknown) {
  const n = Math.round(Number(days));
  if (!Number.isFinite(n) || n < 1 || n > 365) throw new UserError("延ばす日数は1〜365日で入れてください");
  const q = await prisma.quote.findFirst({ where: { id, companyId } });
  if (!q) throw new UserError("見積書が見つかりません");
  if (q.status !== "OPEN") throw new UserError("請求済み・取消の見積書は延ばせません");
  const today = jstDateKey(new Date());
  const until = new Date(Date.parse(`${today}T00:00:00Z`) + n * DAY);
  return prisma.quote.update({ where: { id }, data: { validUntil: until } });
}

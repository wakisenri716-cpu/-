import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { aiFor } from "@/lib/ai/access";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { addressee, getParty, type PartyKind } from "@/lib/addressBook";

// 挨拶状・お礼状: お礼・年末年始の休業・夏季休業などの休業・移転・担当者の交代・お詫び・新しい商品やサービスのご案内を、
// 拝啓/時候の挨拶/本文/敬具(必要なら「記」)の形で作る。宛名は住所録から。
// AIが使えるときは、会社の事情(メモ)に合わせて本文を書き直す(日付・住所・電話番号などの数字は変えない)。何も保存しない。

const MODEL = process.env.ANTHROPIC_ASSISTANT_MODEL || "claude-opus-5-5";
const DAILY_LIMIT = Number(process.env.ASSISTANT_DAILY_LIMIT || 100);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export type GreetingKind = "THANKS" | "HOLIDAY" | "CLOSURE" | "MOVE" | "PERSON" | "APOLOGY" | "LAUNCH";
type Field = { key: string; label: string; placeholder: string; required?: boolean; multiline?: boolean };
export const GREETING_KINDS: Record<GreetingKind, { title: string; subject: string; fields: Field[] }> = {
  THANKS: { title: "お礼状", subject: "御礼", fields: [{ key: "what", label: "何へのお礼か", placeholder: "例: 先日のご来社 / このたびのご注文", required: true }] },
  HOLIDAY: {
    title: "年末年始の休業のお知らせ",
    subject: "年末年始休業のお知らせ",
    fields: [
      { key: "period", label: "休業期間", placeholder: "例: 2026年12月29日(火)〜2027年1月4日(月)", required: true },
      { key: "restart", label: "営業を始める日", placeholder: "例: 2027年1月5日(火)" },
    ],
  },
  CLOSURE: {
    title: "休業のお知らせ(夏季休業など)",
    subject: "休業のお知らせ",
    fields: [
      { key: "name", label: "休業の名前", placeholder: "例: 夏季休業 / 創立記念日", required: true },
      { key: "period", label: "休業期間", placeholder: "例: 2026年8月13日(木)〜8月17日(月)", required: true },
      { key: "restart", label: "営業を始める日", placeholder: "例: 2026年8月18日(火)" },
    ],
  },
  MOVE: {
    title: "移転のお知らせ",
    subject: "事務所移転のお知らせ",
    fields: [
      { key: "date", label: "移転する日(業務を始める日)", placeholder: "例: 2026年11月16日(月)", required: true },
      { key: "address", label: "新しい住所", placeholder: "例: 〒150-0001 東京都渋谷区…", required: true },
      { key: "phone", label: "新しい電話番号(変わるときだけ)", placeholder: "例: 03-1234-5678" },
    ],
  },
  PERSON: {
    title: "担当者交代のご挨拶",
    subject: "担当者交代のご挨拶",
    fields: [
      { key: "before", label: "前の担当者", placeholder: "例: 営業部 佐藤", required: true },
      { key: "after", label: "新しい担当者", placeholder: "例: 営業部 鈴木", required: true },
      { key: "date", label: "交代する日", placeholder: "例: 2026年11月1日" },
    ],
  },
  APOLOGY: {
    title: "お詫び状",
    subject: "お詫び",
    fields: [
      { key: "what", label: "何があったか", placeholder: "例: 10月5日にお届けした商品の数量が不足していました", required: true, multiline: true },
      { key: "action", label: "今後の対応・再発防止", placeholder: "例: 出荷前に2人で数量を確かめる手順に改めました", multiline: true },
    ],
  },
  LAUNCH: {
    title: "新しい商品・サービスのご案内",
    subject: "新サービスのご案内",
    fields: [
      { key: "name", label: "商品・サービスの名前", placeholder: "例: 焼き菓子の定期便", required: true },
      { key: "detail", label: "内容・始める日", placeholder: "例: 毎月10日に季節の焼き菓子を5種お届け。11月から受付開始", multiline: true },
    ],
  },
};

// 時候の挨拶(月ごとの改まった言い方)
const SEASON = ["新春の候", "余寒の候", "早春の候", "陽春の候", "新緑の候", "梅雨の候", "盛夏の候", "残暑の候", "初秋の候", "秋冷の候", "晩秋の候", "師走の候"];
export const seasonal = (dateKey: string) => SEASON[Number(dateKey.slice(5, 7)) - 1];

export type GreetingLetter = { subject: string; opening: string; body: string[]; closing: string; notes: string[]; mode: "claude" | "template" };

export function templateLetter(kind: GreetingKind, f: Record<string, string>, date: string): Omit<GreetingLetter, "mode"> {
  const opening = `拝啓 ${seasonal(date)}、貴社ますますご清栄のこととお慶び申し上げます。平素は格別のお引き立てを賜り、厚く御礼申し上げます。`;
  const closing = "敬具";
  const subject = GREETING_KINDS[kind].subject;
  switch (kind) {
    case "THANKS":
      return { subject, opening, body: [`さて、${f.what}につきましては、誠にありがとうございました。心より御礼申し上げます。`, "今後とも皆様のご期待に添えるよう努めてまいりますので、変わらぬご愛顧を賜りますようお願い申し上げます。", "まずは略儀ながら書中をもちまして御礼申し上げます。"], closing, notes: [] };
    case "HOLIDAY":
      return {
        subject,
        opening,
        body: ["さて、誠に勝手ながら、弊社では下記の期間を年末年始の休業とさせていただきます。", "休業期間中はご不便をおかけいたしますが、何卒ご了承くださいますようお願い申し上げます。", "本年中のご厚情に心より感謝申し上げますとともに、来年も変わらぬご愛顧を賜りますようお願い申し上げます。"],
        closing,
        notes: [`休業期間: ${f.period}`, ...(f.restart ? [`営業開始: ${f.restart}`] : [])],
      };
    case "CLOSURE":
      return {
        subject: `${f.name}のお知らせ`,
        opening,
        body: [
          `さて、誠に勝手ながら、弊社では下記の期間を${f.name}とさせていただきます。`,
          `休業期間中にいただいたお問い合わせ・ご注文につきましては、${f.restart ? `${f.restart}以降` : "休業明け"}に順次ご対応いたします。`,
          "皆様にはご不便をおかけいたしますが、何卒ご了承くださいますようお願い申し上げます。",
        ],
        closing,
        notes: [`休業期間: ${f.period}`, ...(f.restart ? [`営業開始: ${f.restart}`] : [])],
      };
    case "MOVE":
      return {
        subject,
        opening,
        body: ["さて、このたび弊社は業務拡充のため、下記へ事務所を移転することとなりました。", "これを機に、社員一同さらに業務に励んでまいりますので、今後とも一層のご支援を賜りますようお願い申し上げます。", "まずは略儀ながら書中をもちましてご案内申し上げます。"],
        closing,
        notes: [`移転日: ${f.date}`, `新住所: ${f.address}`, ...(f.phone ? [`新電話番号: ${f.phone}`] : [])],
      };
    case "PERSON":
      return {
        subject,
        opening,
        body: [`さて、このたび${f.date ? `${f.date}付で、` : ""}貴社を担当しておりました${f.before}に代わり、${f.after}が担当させていただくことになりました。`, `在任中は${f.before}が格別のご厚情を賜り、誠にありがとうございました。${f.after}につきましても、前任者同様のご指導ご鞭撻を賜りますようお願い申し上げます。`, "まずは略儀ながら書中をもちましてご挨拶申し上げます。"],
        closing,
        notes: [],
      };
    case "APOLOGY":
      return {
        subject,
        opening: `拝啓 ${seasonal(date)}、貴社ますますご清栄のこととお慶び申し上げます。`,
        body: [`このたびは、${f.what.replace(/。$/, "")}。多大なるご迷惑をおかけいたしましたことを、心より深くお詫び申し上げます。`, ...(f.action ? [`今後は、${f.action.replace(/。$/, "")}。二度とこのようなことのないよう、社員一同細心の注意を払ってまいります。`] : ["今後は二度とこのようなことのないよう、社員一同細心の注意を払ってまいります。"]), "何卒ご容赦くださいますよう、重ねてお願い申し上げます。"],
        closing,
        notes: [],
      };
    case "LAUNCH":
      return {
        subject,
        opening,
        body: [`さて、このたび弊社では「${f.name}」を始めることとなりました。`, ...(f.detail ? [`${f.detail.replace(/。$/, "")}。`] : []), "ぜひこの機会にご利用いただけますよう、お願い申し上げます。ご不明な点がございましたら、お気軽にお問い合わせください。"],
        closing,
        notes: [],
      };
  }
}

const SCHEMA = {
  type: "object",
  properties: { body: { type: "array", items: { type: "string" }, description: "本文の段落(「さて、」から結びのあいさつまで。頭語・時候の挨拶・結語は含めない)" } },
  required: ["body"],
  additionalProperties: false,
};
const digits = (s: string) => s.match(/\d[\d,-]*/g)?.map((x) => x.replace(/,/g, "")) ?? [];

export async function draftGreeting(user: { id: string; companyId: string; name: string }, raw: Record<string, unknown>) {
  const kind = String(raw.kind ?? "") as GreetingKind;
  if (!Object.hasOwn(GREETING_KINDS, kind)) throw new UserError("挨拶状の種類を選んでください");
  const date = String(raw.date ?? "") || jstDateKey(new Date());
  if (!DATE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) throw new UserError("日付を正しく入れてください");
  const input = (raw.fields && typeof raw.fields === "object" ? raw.fields : {}) as Record<string, unknown>;
  const f: Record<string, string> = {};
  for (const field of GREETING_KINDS[kind].fields) {
    const v = String(input[field.key] ?? "").replace(/\r\n/g, "\n").trim().slice(0, field.multiline ? 500 : 120);
    if (field.required && !v) throw new UserError(`「${field.label}」を入れてください`);
    f[field.key] = field.multiline ? v : v.replace(/\n/g, " ");
  }
  const notes = String(raw.notes ?? "").trim().slice(0, 1000);
  const partyKind = raw.partyKind === "customer" || raw.partyKind === "vendor" ? (raw.partyKind as PartyKind) : null;
  const party = partyKind && raw.partyId ? await getParty(user.companyId, partyKind, String(raw.partyId)) : null;
  if (partyKind && raw.partyId && !party) throw new UserError("宛先が見つかりません");
  const company = await prisma.company.findUniqueOrThrow({ where: { id: user.companyId }, select: { name: true, address: true, phone: true, representative: true } });
  const base = templateLetter(kind, f, date);
  const to = party ? addressee(party) : null;
  const out = { kind, title: GREETING_KINDS[kind].title, date, to, company, sender: String(raw.sender ?? "").trim().slice(0, 60) || company.representative || user.name };
  if (raw.useAi !== true) return { ...out, ...base, mode: "template" as const };

  const ai = await aiFor(user.companyId);
  if (!ai) throw new UserError("AIが使えません(AIの設定を確かめてください)");
  const today = jstDateKey(new Date());
  if ((await prisma.assistantLog.count({ where: { companyId: user.companyId, createdAt: { gte: new Date(`${today}T00:00:00+09:00`) } } })) >= DAILY_LIMIT) throw new UserError(`AIの利用は1日${DAILY_LIMIT}回までです。明日またお試しください`);
  let result: GreetingLetter = { ...base, mode: "template" };
  try {
    const response = await ai.beta.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: [
        {
          type: "text",
          text: [
            "あなたは小さな会社の総務担当者です。取引先に送る改まった手紙(挨拶状・お礼状・お知らせ・お詫び)の本文を書きます。",
            "渡したひな形の本文(template)をもとに、会社の事情(notes)と入力(fields)に合わせて、ていねいで自然なビジネス文書の言葉に直してください。頭語(拝啓)・時候の挨拶・結語(敬具)は別に付けるので本文に入れないでください。",
            "日付・住所・電話番号・名前・金額は入力のとおりにし、渡していない事実(数字・実績・約束)は作らないでください。",
          ].join("\n"),
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: JSON.stringify({ kind: GREETING_KINDS[kind].title, to: party?.name ?? null, fields: f, notes: notes || null, template: base.body }) }],
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    if (response.stop_reason !== "refusal" && response.stop_reason !== "max_tokens") {
      const parsed = JSON.parse(
        response.content
          .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
          .map((b) => b.text)
          .join(""),
      ) as { body?: unknown };
      const body = (Array.isArray(parsed.body) ? parsed.body : [])
        .filter((p): p is string => typeof p === "string" && !!p.trim())
        .map((p) => p.trim().replace(/^拝啓\s*/, "").replace(/\s*敬具$/, "").slice(0, 500))
        .filter(Boolean)
        .slice(0, 8);
      // 本文に出てくる日付・番号は入力のとおりに残す
      const want = digits(base.body.join(" "));
      const got = new Set(digits(body.join(" ")));
      if (body.length && want.every((n) => got.has(n))) result = { ...base, body, mode: "claude" };
    }
  } catch (error) {
    if (!(error instanceof Anthropic.APIError) && !(error instanceof SyntaxError)) throw error;
  }
  await prisma.assistantLog.create({ data: { companyId: user.companyId, userId: user.id, question: `${GREETING_KINDS[kind].title}の下書き`, tools: [], mode: `greeting-${result.mode}` } });
  return { ...out, ...result };
}

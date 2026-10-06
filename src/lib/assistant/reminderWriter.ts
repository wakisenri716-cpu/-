import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { aiFor } from "@/lib/ai/access";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { formatYen } from "@/lib/format";
import { getReminderContext, reminderMail } from "@/lib/documentMail";
import { getCollectionRow, STAGE_LABELS } from "@/lib/collections";

// AIが督促メールを書く: 遅れている日数・これまでの督促の回数・その顧客のふだんの払い方を見て、
// 関係をこわさず、でも段階に合ったはっきりさで文面を書く。リンク・金額・署名は必ず残す。

const MODEL = process.env.ANTHROPIC_ASSISTANT_MODEL || "claude-opus-5-5";
const DAILY_LIMIT = Number(process.env.ASSISTANT_DAILY_LIMIT || 100);

const SCHEMA = {
  type: "object",
  properties: {
    subject: { type: "string", description: "件名(40字以内)" },
    body: { type: "string", description: "本文。宛名から署名まで全部" },
    reason: { type: "string", description: "この書き方にした理由を承認者向けに一言(60字以内)" },
  },
  required: ["subject", "body", "reason"],
  additionalProperties: false,
} as const;

export async function writeReminderWithAi(user: { id: string; companyId: string }, invoiceId: string, baseUrl: string) {
  const ctx = await getReminderContext(user.companyId, invoiceId, baseUrl);
  const base = reminderMail(ctx);
  const stageNote = STAGE_LABELS[ctx.stage].action;
  const client = await aiFor(user.companyId);
  if (!client) return { ...base, writer: "template", reason: `段階「${STAGE_LABELS[ctx.stage].label}」の決まった文面です。${stageNote}` };

  const since = new Date(`${jstDateKey(new Date())}T00:00:00+09:00`);
  if ((await prisma.assistantLog.count({ where: { companyId: user.companyId, createdAt: { gte: since } } })) >= DAILY_LIMIT) {
    throw new UserError(`AIの利用は1日${DAILY_LIMIT}回までです。明日またお試しください`);
  }
  const row = await getCollectionRow(user.companyId, invoiceId);
  const facts = {
    customer: ctx.customer,
    invoiceNumber: ctx.invoiceNumber,
    issueDate: ctx.issueDate,
    dueDate: ctx.dueDate,
    remaining: formatYen(ctx.remaining),
    partiallyPaid: row?.partiallyPaid ?? false,
    daysOverdue: ctx.daysOverdue,
    remindersSentBefore: ctx.reminders,
    lastReminded: row?.lastReminded ?? null,
    stage: STAGE_LABELS[ctx.stage].label,
    stageGuide: stageNote,
    customerHabit: row?.habit ?? null,
    today: jstDateKey(new Date()),
  };
  let result: { subject: string; body: string; reason: string } | null = null;
  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: [
        {
          type: "text",
          text: [
            "あなたは日本の会社の経理担当として、取引先への入金のお願い(督促)メールを書きます。",
            "段階(stage)に合わせて、はっきりさを変えてください。1回目は「確認のお願い」としてやわらかく、2回目は期限を示してはっきりと、電話の段階では返事を求め電話することを伝え、要相談の段階では期限までに連絡がなければ手続きを検討することを丁寧に伝えます。どの段階でも相手を責めたり脅したりせず、取引を続けたい姿勢を保ってください。",
            "customerHabit はその顧客のこれまでの払い方です(paidCount=入金済みの件数、lateCount=遅れた件数、avgLateDays=平均の遅れ日数)。いつもきちんと払う相手なら「行き違い・手続き漏れ」を気づかう書き方に、遅れがちな相手なら期限をよりはっきり書いてください。一部入金済み(partiallyPaid)なら、そのお礼と残りのお願いにしてください。",
            "本文には、下書きにある宛名・未入金額・振込先・請求書のリンク(URLは一字も変えない)・署名を必ずそのまま入れてください。下書きにない日付・金額・約束を作らないでください。",
          ].join("\n"),
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: `状況:\n${JSON.stringify(facts)}\n\n決まった文面の下書き(これをもとに書き直してください):\n件名: ${base.subject}\n${base.body}` }],
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    if (response.stop_reason !== "refusal" && response.stop_reason !== "max_tokens") {
      const text = response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim();
      const raw = JSON.parse(text) as { subject?: unknown; body?: unknown; reason?: unknown };
      const subject = String(raw.subject ?? "").trim().slice(0, 120);
      const body = String(raw.body ?? "").trim().slice(0, 4000);
      // リンクと金額が入っていない文面は使わない(相手が請求書を開けない・金額がわからないため)
      if (subject && body.includes(ctx.link) && body.includes(formatYen(ctx.remaining))) result = { subject, body, reason: String(raw.reason ?? "").trim().slice(0, 160) };
    }
  } catch (error) {
    if (!(error instanceof Anthropic.APIError) && !(error instanceof SyntaxError)) throw error;
  }
  await prisma.assistantLog.create({ data: { companyId: user.companyId, userId: user.id, question: `督促メールの作成 ${ctx.invoiceNumber}`, tools: [], mode: `reminder-${result ? "claude" : "template"}` } });
  if (!result) return { ...base, writer: "template", reason: `AIの文面が使えなかったため、段階「${STAGE_LABELS[ctx.stage].label}」の決まった文面にしました。` };
  return { to: base.to, ...result, writer: "claude" };
}

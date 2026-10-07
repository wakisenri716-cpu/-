import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { aiFor } from "@/lib/ai/access";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";

// マニュアルのAI手伝い。書き方は ManualBody と同じ(# 見出し / ## 小見出し / 1. 手順 / - 箇条書き / **太字** / 注意: …)。
// ・draft: 走り書きのメモから下書きを作る(AIがないときは決まったルールで手順に並べる)
// ・easy: やさしい日本語に書き直す(外国から来たスタッフ・入ったばかりの人向け)
// ・english: 英語版を作る
// ・check: わかりにくい所・抜けていそうな所を指摘する
// 書き直し・翻訳は、手順の数が減ったら使わない(手順の抜けを防ぐ)。何も保存しない。

const MODEL = process.env.ANTHROPIC_ASSISTANT_MODEL || "claude-opus-5-5";
const DAILY_LIMIT = Number(process.env.ASSISTANT_DAILY_LIMIT || 100);
const MAX_BODY = 20_000;

export type AssistMode = "draft" | "easy" | "english" | "check";
export const ASSIST_MODES: Record<AssistMode, string> = { draft: "メモから下書き", easy: "やさしい日本語", english: "英語版", check: "わかりにくい所のチェック" };

const steps = (body: string) => body.split("\n").filter((l) => /^\s*\d+[.)．]\s*\S/.test(l)).length;

// 決まったルールでの下書き: 準備・注意の行を分け、ほかを番号つきの手順にする
export function templateDraft(notes: string, title: string) {
  const prepare: string[] = [];
  const cautions: string[] = [];
  const list: string[] = [];
  for (const raw of notes.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.replace(/^\s*(?:[・\-*•●○◯■◆▶→>]+\s*|[((]?\d{1,2}[.)、)．]\s*)+/, "").trim();
    if (!line) continue;
    const m = line.match(/^(準備|用意|持ち物|必要なもの)\s*[::]\s*(.*)$/);
    if (m) {
      prepare.push(...m[2].split(/[、,,]/).map((s) => s.trim()).filter(Boolean));
      continue;
    }
    if (/^(注意|重要|NG|気をつけ)/.test(line) || /(してはいけない|しないこと|禁止)/.test(line)) cautions.push(line.replace(/^(注意|重要|NG)\s*[::]\s*/, ""));
    else list.push(line);
  }
  const lines = [`# ${title || "手順"}`];
  if (prepare.length) lines.push("", "## 準備するもの", ...prepare.map((p) => `- ${p}`));
  if (list.length) lines.push("", "## 手順", ...list.map((s, i) => `${i + 1}. ${s}`));
  if (cautions.length) lines.push("", ...cautions.map((c) => `注意: ${c}`));
  return lines.join("\n");
}

const SCHEMA_TEXT = {
  type: "object",
  properties: {
    title: { type: "string", description: "マニュアルのタイトル(30文字以内)" },
    body: { type: "string", description: "本文(# 見出し / ## 小見出し / 1. 手順 / - 箇条書き / **太字** / 注意: の書き方で)" },
  },
  required: ["title", "body"],
  additionalProperties: false,
};
const SCHEMA_CHECK = {
  type: "object",
  properties: {
    points: {
      type: "array",
      items: { type: "object", properties: { where: { type: "string", description: "どこか(手順の番号や見出し)" }, issue: { type: "string" }, suggestion: { type: "string" } }, required: ["where", "issue", "suggestion"], additionalProperties: false },
      description: "わかりにくい所・抜けていそうな所(8つまで)",
    },
  },
  required: ["points"],
  additionalProperties: false,
};

const PROMPTS: Record<AssistMode, string> = {
  draft: "店や会社で働くスタッフ向けのマニュアルを書く担当者です。渡したメモから、誰が読んでも同じようにできるマニュアルの下書きを書いてください。準備するもの・手順(番号つき・1つの手順に1つの動作)・注意を分けます。メモに書いていない数字・ルール・道具は作らず、わからない所は「(確認: …)」と書いて残してください。",
  easy: "マニュアルを「やさしい日本語」に書き直す担当者です。外国から来たスタッフや入ったばかりの人が読めるよう、1文を短く、むずかしい言葉・漢字の熟語・カタカナ語はやさしい言い方に直してください。手順の数・順番・数字・注意の中身は変えないでください。",
  english: "You translate an internal work manual from Japanese into clear, simple English for staff. Keep the same structure and markup (# heading, ## subheading, numbered steps '1.', '- ' bullets, **bold**, and lines starting with '注意:' must start with 'Caution:'). Keep every step, number and amount. Do not add new rules.",
  check: "マニュアルをチェックする担当者です。初めて読む人がつまずきそうな所(あいまいな言い方・手順の抜け・順番がおかしい所・安全や衛生の注意が足りない所・数字や基準がない所)を、8つまで指摘してください。問題がなければ points は空にします。",
};

export async function assistManual(user: { id: string; companyId: string }, input: { mode?: unknown; title?: unknown; notes?: unknown; body?: unknown; useAi?: unknown }) {
  const mode = String(input.mode ?? "") as AssistMode;
  if (!Object.hasOwn(ASSIST_MODES, mode)) throw new UserError("手伝いの種類を選んでください");
  const title = String(input.title ?? "").replace(/[\r\n]/g, " ").trim().slice(0, 80);
  const text = String(input[mode === "draft" ? "notes" : "body"] ?? "").replace(/\r\n/g, "\n").trim();
  if (!text) throw new UserError(mode === "draft" ? "メモを入れてください" : "本文がありません");
  if (text.length > MAX_BODY) throw new UserError("長すぎます(20,000文字まで)");

  const ai = await aiFor(user.companyId);
  if (mode === "draft" && (!ai || input.useAi === false)) return { mode, title: title || "手順", body: templateDraft(text, title), via: "template" as const };
  if (!ai) throw new UserError("AIが使えません(AIの設定を確かめてください)");
  const today = jstDateKey(new Date());
  if ((await prisma.assistantLog.count({ where: { companyId: user.companyId, createdAt: { gte: new Date(`${today}T00:00:00+09:00`) } } })) >= DAILY_LIMIT) throw new UserError(`AIの利用は1日${DAILY_LIMIT}回までです。明日またお試しください`);

  let result: { title: string; body: string; via: "claude" | "template" } | { points: { where: string; issue: string; suggestion: string }[]; via: "claude" } | null = null;
  try {
    const response = await ai.beta.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: [{ type: "text", text: PROMPTS[mode], cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: JSON.stringify({ title: title || null, [mode === "draft" ? "notes" : "body"]: text }) }],
      output_config: { effort: "medium", format: { type: "json_schema", schema: mode === "check" ? SCHEMA_CHECK : SCHEMA_TEXT } },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    if (response.stop_reason !== "refusal" && response.stop_reason !== "max_tokens") {
      const raw = JSON.parse(
        response.content
          .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
          .map((b) => b.text)
          .join(""),
      ) as { title?: unknown; body?: unknown; points?: unknown };
      if (mode === "check") {
        const points = (Array.isArray(raw.points) ? raw.points : [])
          .map((p) => p as { where?: unknown; issue?: unknown; suggestion?: unknown })
          .filter((p) => typeof p.issue === "string" && p.issue.trim())
          .map((p) => ({ where: typeof p.where === "string" ? p.where.trim().slice(0, 40) : "", issue: String(p.issue).trim().slice(0, 200), suggestion: typeof p.suggestion === "string" ? p.suggestion.trim().slice(0, 200) : "" }))
          .slice(0, 8);
        result = { points, via: "claude" };
      } else {
        const body = typeof raw.body === "string" ? raw.body.replace(/\r\n/g, "\n").trim().slice(0, MAX_BODY) : "";
        const newTitle = typeof raw.title === "string" ? raw.title.replace(/[\r\n]/g, " ").trim().slice(0, 80) : "";
        // 書き直し・翻訳で手順が減ったら使わない
        const okSteps = mode === "draft" || steps(body) >= steps(text);
        if (body && okSteps) result = { title: newTitle || title || "手順", body, via: "claude" };
      }
    }
  } catch (error) {
    if (!(error instanceof Anthropic.APIError) && !(error instanceof SyntaxError)) throw error;
  }
  await prisma.assistantLog.create({ data: { companyId: user.companyId, userId: user.id, question: `マニュアル: ${ASSIST_MODES[mode]}`, tools: [], mode: `manual-${mode}-${result ? "claude" : "failed"}` } });
  if (!result) {
    if (mode === "draft") return { mode, title: title || "手順", body: templateDraft(text, title), via: "template" as const };
    throw new UserError(mode === "check" ? "チェックできませんでした。少し待ってからもう一度お試しください" : "うまく書き直せませんでした(手順が減ったため使いませんでした)。もう一度お試しください");
  }
  return { mode, ...result };
}

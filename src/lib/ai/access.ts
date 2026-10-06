import Anthropic from "@anthropic-ai/sdk";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import { companyBilling } from "@/lib/billing";
import { AI_MODE_INFO, type AiMode } from "@/lib/billing/plans";

// AIの使い方(会社ごと)
// ・INCLUDED(AI込み): このサービスのAIのキー(ANTHROPIC_API_KEY)で動かす。AIの利用料はサービス持ち
// ・BYO(AI持ち込み): 会社が自分で契約したAIのキーで動かす。キーがなければAIは使わず、決まったルールで動く
// AIを使う機能は、どれも aiFor(companyId) で使うAIを受け取り、null なら決まったルール(テンプレート)で動く。

export type { AiMode };

// 会社のAIのキーは暗号化して保存する(AI_KEY_SECRET。なければ DATABASE_URL から作る)
function cipherKey() {
  const secret = process.env.AI_KEY_SECRET || process.env.DATABASE_URL || "";
  if (!secret) throw new UserError("AIのキーを保存する準備ができていません(AI_KEY_SECRET を設定してください)");
  return createHash("sha256").update(`ai-key:${secret}`).digest();
}

export function encryptKey(plain: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", cipherKey(), iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1:${iv.toString("base64")}:${c.getAuthTag().toString("base64")}:${data.toString("base64")}`;
}

export function decryptKey(stored: string): string | null {
  try {
    const [v, iv, tag, data] = stored.split(":");
    if (v !== "v1") return null;
    const d = createDecipheriv("aes-256-gcm", cipherKey(), Buffer.from(iv, "base64"));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export async function getAiSettings(companyId: string) {
  const c = await prisma.company.findUnique({ where: { id: companyId }, select: { aiMode: true, aiKeyEnc: true, aiKeyHint: true, aiKeySetAt: true } });
  const mode = (c?.aiMode === "BYO" ? "BYO" : "INCLUDED") as AiMode;
  const { state } = await companyBilling(companyId);
  // 契約中は、申し込んだプラン(AI込み・AI持ち込み)に合わせる。切り替えは「お支払い情報の管理」から
  const locked = state.phase === "active" || state.phase === "past_due";
  const serviceAi = !!process.env.ANTHROPIC_API_KEY;
  const hasKey = !!c?.aiKeyEnc;
  return { mode, modeName: AI_MODE_INFO[mode].name, hasKey, keyHint: c?.aiKeyHint ?? null, keySetAt: c?.aiKeySetAt ?? null, serviceAi, locked, active: mode === "BYO" ? hasKey : serviceAi };
}

// 使い方を切り替える(契約していない間だけ。契約中は申し込んだプランで決まる)
export async function setAiMode(companyId: string, modeInput: unknown) {
  if (modeInput !== "INCLUDED" && modeInput !== "BYO") throw new UserError("AIの使い方を選んでください");
  const now = await getAiSettings(companyId);
  if (now.locked && now.mode !== modeInput) throw new UserError("ご契約中は、申し込んだプランのAIの使い方になります。切り替えは「契約・お支払い」→「お支払い情報の管理」からプランを変えてください");
  await prisma.company.update({ where: { id: companyId }, data: { aiMode: modeInput } });
  return getAiSettings(companyId);
}

// この会社で使うAI(使えなければ null)
export async function aiFor(companyId: string): Promise<Anthropic | null> {
  const c = await prisma.company.findUnique({ where: { id: companyId }, select: { aiMode: true, aiKeyEnc: true } });
  if (c?.aiMode === "BYO") {
    const key = c.aiKeyEnc ? decryptKey(c.aiKeyEnc) : null;
    return key ? new Anthropic({ apiKey: key }) : null;
  }
  return process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;
}

export async function aiEnabled(companyId: string) {
  return (await aiFor(companyId)) !== null;
}

// AI持ち込みのキーを確かめてから保存する(短い問い合わせで、使えるキーか確かめる)
export async function saveCompanyAiKey(companyId: string, keyInput: unknown) {
  const key = String(keyInput ?? "").trim();
  if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key) && !(process.env.NODE_ENV !== "production" && key.startsWith("sk-test-"))) throw new UserError("AnthropicのAPIキー(sk-ant- で始まる文字)を入れてください");
  try {
    await new Anthropic({ apiKey: key }).models.list({ limit: 1 });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) throw new UserError("このキーではAIにつながりませんでした。キーを確かめてください");
    if (!(error instanceof Anthropic.APIError)) throw error;
  }
  await prisma.company.update({ where: { id: companyId }, data: { aiKeyEnc: encryptKey(key), aiKeyHint: key.slice(-4), aiKeySetAt: new Date() } });
  return getAiSettings(companyId);
}

export async function clearCompanyAiKey(companyId: string) {
  await prisma.company.update({ where: { id: companyId }, data: { aiKeyEnc: null, aiKeyHint: null, aiKeySetAt: null } });
  return getAiSettings(companyId);
}

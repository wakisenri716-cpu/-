import { createHash, randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { companyBilling } from "@/lib/billing";

// 会社が自分のAI(Claude など)からつなぐための鍵(MCP)。
// 鍵は作ったときに一度だけ見せ、データベースにはハッシュだけを残す(なくしたら作り直す)。

export const MAX_TOKENS = 10;
// 1つの鍵で1日に使える道具の回数
export const DAILY_CALLS = 2000;
const TOKEN_RE = /^mcp_[A-Za-z0-9_-]{32}$/;

const hashOf = (token: string) => createHash("sha256").update(token).digest("hex");

export async function listMcpTokens(companyId: string) {
  const rows = await prisma.mcpToken.findMany({
    where: { companyId, revokedAt: null },
    select: { id: true, name: true, prefix: true, createdAt: true, lastUsedAt: true, callDay: true, callCount: true, user: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });
  const today = jstDateKey(new Date());
  return rows.map((r) => ({ id: r.id, name: r.name, prefix: r.prefix, createdAt: r.createdAt, lastUsedAt: r.lastUsedAt, callsToday: r.callDay === today ? r.callCount : 0, createdBy: r.user.name }));
}

export async function createMcpToken(companyId: string, userId: string, nameInput: unknown) {
  const name = String(nameInput ?? "").trim().slice(0, 40);
  if (!name) throw new UserError("つなぐAIの名前(例: 社長のClaude)を入れてください");
  if ((await prisma.mcpToken.count({ where: { companyId, revokedAt: null } })) >= MAX_TOKENS) throw new UserError(`つなぎ方は${MAX_TOKENS}個までです。使っていないものを削除してください`);
  const token = `mcp_${randomBytes(24).toString("base64url")}`;
  const row = await prisma.mcpToken.create({ data: { companyId, userId, name, tokenHash: hashOf(token), prefix: token.slice(0, 8) } });
  return { id: row.id, name, token };
}

export async function revokeMcpToken(companyId: string, id: string) {
  const row = await prisma.mcpToken.findFirst({ where: { id, companyId, revokedAt: null } });
  if (!row) throw new UserError("つなぎ方が見つかりません");
  await prisma.mcpToken.update({ where: { id }, data: { revokedAt: new Date() } });
  return { name: row.name };
}

export type McpCaller = { tokenId: string; tokenName: string; companyId: string; companyName: string; user: { id: string; name: string; companyId: string } };

// 鍵を確かめる。使えないときは理由を返す(どれも「つなげない」扱い)
export async function authenticateMcp(token: string | null): Promise<McpCaller | { error: string }> {
  if (!token) return { error: "鍵がありません。AIの設定で作った鍵を使ってください" };
  if (!TOKEN_RE.test(token)) return { error: "この鍵は使えません(形が正しくありません)" };
  const row = await prisma.mcpToken.findUnique({ where: { tokenHash: hashOf(token) }, include: { company: { select: { name: true } }, user: { select: { id: true, name: true } } } });
  if (!row || row.revokedAt) return { error: "この鍵は使えません(削除されたか、間違っています)" };
  // 作った人がいまも管理者・経理担当として会社にいるときだけ使える
  const member = await prisma.companyMember.findUnique({ where: { userId_companyId: { userId: row.userId, companyId: row.companyId } }, select: { role: true, active: true } });
  if (!member?.active || member.role === "EMPLOYEE") return { error: "この鍵を作った人は、いまはこの会社のデータを見られません" };
  const { state } = await companyBilling(row.companyId);
  if (!state.access) return { error: "ご契約が切れているため使えません。「契約・お支払い」からお申し込みください" };
  return { tokenId: row.id, tokenName: row.name, companyId: row.companyId, companyName: row.company.name, user: { id: row.user.id, name: row.user.name, companyId: row.companyId } };
}

// 道具を使うたびに数える(1日の上限を超えたら断る)
export async function countMcpCall(tokenId: string) {
  const today = jstDateKey(new Date());
  const row = await prisma.mcpToken.findUniqueOrThrow({ where: { id: tokenId }, select: { callDay: true, callCount: true } });
  const count = row.callDay === today ? row.callCount : 0;
  if (count >= DAILY_CALLS) return false;
  await prisma.mcpToken.update({ where: { id: tokenId }, data: { callDay: today, callCount: count + 1, lastUsedAt: new Date() } });
  return true;
}

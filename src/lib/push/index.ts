import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import { apnsConfig, fcmConfig } from "./config";
import { sendApns } from "./apns";
import { sendFcm } from "./fcm";
import type { PushMessage } from "./types";

// スマホアプリのプッシュ通知: 端末の登録と、人にあてた送信

const PLATFORMS = ["ios", "android"] as const;

export function pushStatus() {
  return { ios: !!apnsConfig(), android: !!fcmConfig() };
}

export async function registerDevice(userId: string, input: { token?: unknown; platform?: unknown }) {
  const token = String(input.token ?? "").trim();
  const platform = String(input.platform ?? "");
  if (!token || token.length > 4096) throw new UserError("端末のトークンが正しくありません");
  if (!(PLATFORMS as readonly string[]).includes(platform)) throw new UserError("端末の種類が正しくありません");
  // 同じ端末で別の人がログインし直したら、その人の端末にする
  return prisma.pushDevice.upsert({ where: { token }, create: { userId, platform, token }, update: { userId, platform, lastSeenAt: new Date() } });
}

export async function unregisterDevice(userId: string, token: unknown) {
  await prisma.pushDevice.deleteMany({ where: { userId, token: String(token ?? "") } });
}

export async function countDevices(userId: string) {
  return prisma.pushDevice.count({ where: { userId } });
}

// 人にあてて送る(端末がない人・設定がない機種は飛ばす)
export async function sendToUsers(userIds: string[], message: PushMessage) {
  const ids = [...new Set(userIds)].filter(Boolean);
  const total = { sent: 0, failed: 0, removed: 0, errors: [] as string[] };
  if (!ids.length) return total;
  const devices = await prisma.pushDevice.findMany({ where: { userId: { in: ids } } });
  const apns = apnsConfig();
  const fcm = fcmConfig();
  const results = await Promise.all([
    apns ? sendApns(apns, devices.filter((d) => d.platform === "ios").map((d) => d.token), message) : null,
    fcm ? sendFcm(fcm, devices.filter((d) => d.platform === "android").map((d) => d.token), message) : null,
  ]);
  const invalid: string[] = [];
  for (const r of results) {
    if (!r) continue;
    total.sent += r.sent;
    total.failed += r.failed;
    invalid.push(...r.invalid);
    if (r.error) total.errors.push(r.error);
  }
  // アプリを消したなどで使えなくなった端末は消す
  if (invalid.length) total.removed = (await prisma.pushDevice.deleteMany({ where: { token: { in: invalid } } })).count;
  return total;
}

// 画面の返事を待たせないよう、返事のあとに送る(失敗しても画面の操作は失敗にしない)
export function notifyLater(userIds: string[] | (() => Promise<string[]>), message: PushMessage | (() => Promise<PushMessage | null>)) {
  after(async () => {
    try {
      const ids = typeof userIds === "function" ? await userIds() : userIds;
      const msg = typeof message === "function" ? await message() : message;
      if (msg && ids.length) await sendToUsers(ids, msg);
    } catch (error) {
      console.error("push notification failed", error);
    }
  });
}

// 会社の在籍メンバー(書いた本人を除く)
export async function companyMemberIds(companyId: string, exceptUserId?: string) {
  const members = await prisma.companyMember.findMany({ where: { companyId, active: true }, select: { userId: true } });
  return members.map((m) => m.userId).filter((id) => id !== exceptUserId);
}

export type { PushMessage };

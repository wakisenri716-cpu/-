import { rs256Jwt } from "./jwt";
import type { FcmConfig } from "./config";
import type { PushMessage, SendResult } from "./types";

// Google のアクセストークン(1時間)。55分ごとに取り直す
let cached: { token: string; at: number; email: string } | null = null;
async function accessToken(config: FcmConfig) {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.email === config.clientEmail && now - cached.at < 55 * 60) return cached.token;
  const assertion = rs256Jwt(
    { alg: "RS256", typ: "JWT" },
    { iss: config.clientEmail, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 },
    config.privateKey,
  );
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) throw new Error(`FCM の認証に失敗しました(${res.status})`);
  cached = { token: json.access_token, at: now, email: config.clientEmail };
  return cached.token;
}

// Android に送る(FCM HTTP v1)。使えなくなった端末のトークンを invalid で返す
export async function sendFcm(config: FcmConfig, tokens: string[], message: PushMessage): Promise<SendResult> {
  const result: SendResult = { sent: 0, failed: 0, invalid: [] };
  if (!tokens.length) return result;
  let token: string;
  try {
    token = await accessToken(config);
  } catch (e) {
    return { sent: 0, failed: tokens.length, invalid: [], error: e instanceof Error ? e.message : "FCM の認証に失敗しました" };
  }
  await Promise.all(
    tokens.map(async (deviceToken) => {
      const res = await fetch(`https://fcm.googleapis.com/v1/projects/${config.projectId}/messages:send`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          message: {
            token: deviceToken,
            notification: { title: message.title, body: message.body },
            data: { url: message.url ?? "" },
            android: { priority: "HIGH", notification: { sound: "default" } },
          },
        }),
      }).catch(() => null);
      if (res?.ok) return void result.sent++;
      result.failed++;
      const text = res ? await res.text().catch(() => "") : "";
      if (res && (res.status === 404 || /UNREGISTERED/.test(text) || (/INVALID_ARGUMENT/.test(text) && /registration token/i.test(text)))) result.invalid.push(deviceToken);
      else result.error = `FCM ${res?.status ?? "接続できません"}`;
    }),
  );
  return result;
}

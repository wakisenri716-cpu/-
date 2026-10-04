import { connect } from "node:http2";
import { es256Jwt } from "./jwt";
import type { ApnsConfig } from "./config";
import type { PushMessage, SendResult } from "./types";

// APNs の認証トークンは1時間まで使える。50分ごとに作り直す
let cached: { token: string; at: number; keyId: string } | null = null;
function authToken(config: ApnsConfig) {
  const now = Math.floor(Date.now() / 1000);
  if (!cached || cached.keyId !== config.keyId || now - cached.at > 50 * 60) {
    cached = { token: es256Jwt({ alg: "ES256", kid: config.keyId }, { iss: config.teamId, iat: now }, config.key), at: now, keyId: config.keyId };
  }
  return cached.token;
}

// iPhone にまとめて送る(APNs は HTTP/2 だけ)。使えなくなった端末のトークンを invalid で返す
export async function sendApns(config: ApnsConfig, tokens: string[], message: PushMessage): Promise<SendResult> {
  const result: SendResult = { sent: 0, failed: 0, invalid: [] };
  if (!tokens.length) return result;
  const client = connect(config.host);
  client.on("error", () => {});
  const body = JSON.stringify({ aps: { alert: { title: message.title, body: message.body }, sound: "default" }, url: message.url ?? "" });
  try {
    await Promise.all(
      tokens.map(
        (token) =>
          new Promise<void>((resolve) => {
            const req = client.request({
              ":method": "POST",
              ":path": `/3/device/${token}`,
              authorization: `bearer ${authToken(config)}`,
              "apns-topic": config.bundleId,
              "apns-push-type": "alert",
              "apns-priority": "10",
              "content-type": "application/json",
            });
            let status = 0;
            let text = "";
            let error = "";
            req.on("response", (headers) => (status = Number(headers[":status"])));
            req.on("data", (chunk) => (text += chunk));
            req.on("error", (e) => (error = e.message));
            // close は、返事が来たときも・エラーや時間切れのときも必ず来る
            req.on("close", () => {
              if (status === 200) result.sent++;
              else {
                result.failed++;
                const reason = (() => {
                  try {
                    return JSON.parse(text).reason as string;
                  } catch {
                    return "";
                  }
                })();
                if (status === 410 || reason === "BadDeviceToken" || reason === "Unregistered" || reason === "DeviceTokenNotForTopic") result.invalid.push(token);
                else result.error = status ? `APNs ${status} ${reason}` : error || "APNs に接続できませんでした";
              }
              resolve();
            });
            req.setTimeout(10_000, () => req.close());
            req.end(body);
          }),
      ),
    );
  } finally {
    client.close();
  }
  return result;
}

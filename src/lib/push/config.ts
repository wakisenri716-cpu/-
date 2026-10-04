// プッシュ通知の設定(Vercel の環境変数)。どちらも、なければその端末には送らない。
//   iPhone(APNs): APNS_KEY_ID・APNS_TEAM_ID・APNS_KEY(.p8 の中身)・APNS_BUNDLE_ID(省略時 com.saaserp.staffapp)・APNS_ENV(production / development)
//   Android(FCM): FCM_SERVICE_ACCOUNT(Firebase のサービスアカウントの JSON)

export type ApnsConfig = { keyId: string; teamId: string; key: string; bundleId: string; host: string };
export type FcmConfig = { projectId: string; clientEmail: string; privateKey: string };

// 環境変数に貼ると改行が「\n」の文字になることがあるので戻す
const pem = (v: string) => v.replace(/\\n/g, "\n").trim();

export function apnsConfig(): ApnsConfig | null {
  const { APNS_KEY_ID, APNS_TEAM_ID, APNS_KEY } = process.env;
  if (!APNS_KEY_ID || !APNS_TEAM_ID || !APNS_KEY) return null;
  return {
    keyId: APNS_KEY_ID.trim(),
    teamId: APNS_TEAM_ID.trim(),
    key: pem(APNS_KEY),
    bundleId: (process.env.APNS_BUNDLE_ID || "com.saaserp.staffapp").trim(),
    // TestFlight・App Store のアプリは production。Xcode から直接入れたアプリだけ development
    host: process.env.APNS_ENV === "development" ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com",
  };
}

export function fcmConfig(): FcmConfig | null {
  const raw = process.env.FCM_SERVICE_ACCOUNT;
  if (!raw) return null;
  try {
    const json = JSON.parse(raw);
    if (!json.project_id || !json.client_email || !json.private_key) return null;
    return { projectId: json.project_id, clientEmail: json.client_email, privateKey: pem(json.private_key) };
  } catch {
    return null;
  }
}

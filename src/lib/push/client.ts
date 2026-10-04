import { Capacitor } from "@capacitor/core";

// スマホアプリ(mobile/ の Capacitor)の中で動くときだけ使う、通知の受け取りの準備

export const TOKEN_KEY = "pushToken";
export const DISMISS_KEY = "pushBannerDismissed";

const store = {
  get: (key: string) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set: (key: string, value: string | null) => {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {}
  },
};
export const pushStore = store;

// 通知を使える端末か。Android は Firebase の設定を入れて作ったアプリだけ(入れずに通知を始めるとアプリが落ちる)
export function pushPlatform(): "ios" | "android" | null {
  if (typeof navigator === "undefined" || !navigator.userAgent.includes("StaffAppNative")) return null;
  if (!Capacitor.isNativePlatform()) return null;
  const platform = Capacitor.getPlatform();
  if (platform === "ios") return "ios";
  if (platform === "android" && / fcm\b/.test(navigator.userAgent)) return "android";
  return null;
}

async function plugin() {
  return (await import("@capacitor/push-notifications")).PushNotifications;
}

export async function pushPermission(): Promise<"granted" | "denied" | "prompt"> {
  const { receive } = await (await plugin()).checkPermissions();
  return receive === "granted" ? "granted" : receive === "denied" ? "denied" : "prompt";
}

let listening = false;

// 端末のトークンが届いたらサーバーへ登録、通知をタップしたらその画面を開く
export async function listenPush(platform: "ios" | "android", onRegistered?: () => void) {
  if (listening) return;
  listening = true;
  const push = await plugin();
  await push.addListener("registration", async ({ value }) => {
    const res = await fetch("/api/push/devices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: value, platform }) }).catch(() => null);
    if (res?.ok) {
      store.set(TOKEN_KEY, value);
      onRegistered?.();
      window.dispatchEvent(new Event("push-registered"));
    }
  });
  await push.addListener("registrationError", (e) => console.error("push registration failed", e.error));
  await push.addListener("pushNotificationActionPerformed", ({ notification }) => {
    const url = String((notification.data as { url?: unknown } | undefined)?.url ?? "");
    // 自分のサイトの中の画面だけ開く
    if (url.startsWith("/") && !url.startsWith("//")) window.location.assign(url);
  });
}

// 通知を許可してもらい、端末を登録する(許可済みならそのまま登録)
export async function enablePush(platform: "ios" | "android") {
  const push = await plugin();
  await listenPush(platform);
  let permission = await pushPermission();
  if (permission === "prompt") permission = (await push.requestPermissions()).receive === "granted" ? "granted" : "denied";
  if (permission !== "granted") return false;
  await push.register();
  return true;
}

// ログアウトの前に、この端末への通知を止める
export async function forgetPushDevice() {
  const token = store.get(TOKEN_KEY);
  if (!token) return;
  await fetch("/api/push/devices", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) }).catch(() => null);
  store.set(TOKEN_KEY, null);
}

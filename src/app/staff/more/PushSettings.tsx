"use client";

import { Capacitor } from "@capacitor/core";
import { useCallback, useEffect, useState } from "react";
import { TOKEN_KEY, enablePush, pushPermission, pushPlatform, pushStore } from "@/lib/push/client";

type Status = { ios: boolean; android: boolean; devices: number };
type Device = "web" | "no-fcm" | "prompt" | "denied" | "granted" | "registered";

// 「その他」の通知の設定: この端末で受け取れるか・ためしに送る
export function PushSettings() {
  const [status, setStatus] = useState<Status | null>(null);
  const [device, setDevice] = useState<Device | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const platform = pushPlatform();

  const load = useCallback(async () => {
    const res = await fetch("/api/push/status");
    if (res.ok) setStatus(await res.json());
    if (!platform) {
      setDevice(typeof navigator !== "undefined" && navigator.userAgent.includes("StaffAppNative") && Capacitor.getPlatform() === "android" ? "no-fcm" : "web");
      return;
    }
    const permission = await pushPermission().catch(() => "prompt" as const);
    setDevice(permission === "granted" ? (pushStore.get(TOKEN_KEY) ? "registered" : "granted") : permission);
  }, [platform]);

  useEffect(() => {
    // Fetch-on-mount: setState always lands after the fetch's await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    window.addEventListener("push-registered", load);
    return () => window.removeEventListener("push-registered", load);
  }, [load]);

  async function enable() {
    if (!platform) return;
    setBusy(true);
    const ok = await enablePush(platform).catch(() => false);
    setBusy(false);
    if (!ok) setMessage({ ok: false, text: "通知が許可されませんでした。スマホの「設定」→「Clerkly従業員用」→「通知」をオンにしてください" });
    await load();
  }

  async function test() {
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/push/test", { method: "POST" });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) setMessage({ ok: false, text: json.error || "送れませんでした" });
    else if (json.sent > 0) setMessage({ ok: true, text: `${json.sent}台の端末に送りました。数秒で届きます` });
    else setMessage({ ok: false, text: json.errors?.length ? `送れませんでした(${json.errors[0]})` : "送れる端末がありません" });
    await load();
  }

  if (!status || !device) return null;
  const serverReady = platform ? status[platform] : status.ios || status.android;

  return (
    <section className="space-y-2 rounded-2xl bg-white p-4 text-sm shadow-sm ring-1 ring-slate-200">
      <h2 className="font-semibold">通知</h2>
      <p className="text-slate-600">シフトが決まったとき・変わったとき、新しいマニュアルや社内のお知らせが出たとき、申請が承認・却下されたときに、スマホに通知が届きます。</p>
      {device === "web" && <p className="text-slate-600">通知は、スマホのアプリ(Clerkly従業員用)で受け取れます。アプリの入れ方は管理者に聞いてください。</p>}
      {device === "no-fcm" && <p className="text-amber-700">このアプリは通知の設定なしで作られています。管理者に、通知を使えるアプリを作り直してもらってください(mobile/PUSH.md)。</p>}
      {device === "denied" && <p className="text-amber-700">通知がオフになっています。スマホの「設定」→「Clerkly従業員用」→「通知」をオンにしてください。</p>}
      {(device === "prompt" || device === "granted") && (
        <button onClick={enable} disabled={busy} className="w-full rounded-full bg-vermilion-600 px-4 py-2.5 font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
          通知を受け取る
        </button>
      )}
      {device === "registered" && <p className="text-emerald-700">✓ この端末で通知を受け取ります</p>}
      {platform && !serverReady && <p className="text-amber-700">まだサーバー側の通知の設定がされていません。管理者に設定を頼んでください(mobile/PUSH.md)。</p>}
      {status.devices > 0 && (
        <button onClick={test} disabled={busy} className="w-full rounded-full border border-slate-300 px-4 py-2.5 font-medium text-slate-700 disabled:opacity-50">
          ためしに通知を送る({status.devices}台)
        </button>
      )}
      {message && <p className={message.ok ? "text-emerald-700" : "text-rose-600"}>{message.text}</p>}
    </section>
  );
}

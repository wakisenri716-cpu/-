"use client";

import { useEffect, useState } from "react";
import { DISMISS_KEY, enablePush, listenPush, pushPermission, pushPlatform, pushStore } from "@/lib/push/client";

// スマホアプリで開いたとき: 通知が許可済みなら端末を登録し直し、まだなら「通知を受け取る」の案内を出す
export function NativePush() {
  const [ask, setAsk] = useState<"ios" | "android" | null>(null);

  useEffect(() => {
    const platform = pushPlatform();
    if (!platform) return;
    (async () => {
      await listenPush(platform);
      const permission = await pushPermission();
      if (permission === "granted") await enablePush(platform);
      else if (permission === "prompt" && !pushStore.get(DISMISS_KEY)) setAsk(platform);
    })().catch((e) => console.error("push setup failed", e));
  }, []);

  if (!ask) return null;
  return (
    <div className="fixed inset-x-3 bottom-24 z-50 rounded-2xl bg-slate-900 p-4 text-sm text-white shadow-lg md:bottom-6 md:left-auto md:w-96 print:hidden">
      <p className="font-medium">通知を受け取りますか?</p>
      <p className="mt-1 text-slate-300">シフトが決まったとき・新しいマニュアルやお知らせが出たとき・申請の結果をお知らせします。</p>
      <div className="mt-3 flex justify-end gap-2">
        <button
          onClick={() => {
            pushStore.set(DISMISS_KEY, "1");
            setAsk(null);
          }}
          className="rounded-full px-4 py-2 text-slate-300"
        >
          あとで
        </button>
        <button
          onClick={async () => {
            const platform = ask;
            setAsk(null);
            await enablePush(platform).catch(() => false);
          }}
          className="rounded-full bg-white px-4 py-2 font-medium text-slate-900"
        >
          通知を受け取る
        </button>
      </div>
    </div>
  );
}

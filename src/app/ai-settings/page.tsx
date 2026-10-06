"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { formatDate } from "@/lib/format";

type Mode = "INCLUDED" | "BYO";
type Settings = { mode: Mode; modeName: string; hasKey: boolean; keyHint: string | null; keySetAt: string | null; serviceAi: boolean; locked: boolean; active: boolean };

const MODES: { key: Mode; name: string; text: string }[] = [
  { key: "INCLUDED", name: "AI込み", text: "このサービスのAIをそのまま使います。キーの用意は要りません。AIの利用料は月額に含まれます。" },
  { key: "BYO", name: "AI持ち込み", text: "自社で契約したAI(Anthropic の API キー)を使います。月額がお安くなり、AIの利用料は自社でのお支払いになります。" },
];

export default function AiSettingsPage() {
  const [data, setData] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/ai-settings");
    const body = await res.json();
    if (!res.ok) setError(body.error || "読み込めませんでした");
    else setData(body);
  }, []);

  useEffect(() => {
    // Fetch-on-mount: setState always lands after the fetch's await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function send(payload: Record<string, unknown>, done: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    const res = await fetch("/api/ai-settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(body.error || "保存できませんでした");
      return false;
    }
    setData(body);
    setMessage(done);
    return true;
  }

  async function saveKey(e: FormEvent) {
    e.preventDefault();
    if (await send({ action: "key", key }, "キーを確かめて登録しました。これからはこのキーでAIが動きます")) setKey("");
  }

  if (!data) return <div className="mx-auto max-w-3xl text-sm text-slate-500">{error ?? "読み込み中..."}</div>;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">AIの設定</h1>
        <p className="mt-1 text-sm text-slate-600">仕訳・書類の読み取り・アシスタントなど、AIを使う機能をどのAIで動かすかを決めます。</p>
      </div>

      <section className={`flex items-start gap-3 rounded-xl px-5 py-4 text-sm ${data.active ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-900"}`}>
        <span className={`mt-1 inline-block size-2.5 shrink-0 rounded-full ${data.active ? "bg-emerald-500" : "bg-amber-500"}`} />
        <div>
          <p className="font-medium">{data.active ? `AIが使えます(${data.modeName})` : `今はAIを使わずに動いています(${data.modeName})`}</p>
          <p className="mt-0.5">
            {data.active
              ? "AIが書類を読み取り、仕訳や文面の下書きを作ります。"
              : data.mode === "BYO"
                ? "AI持ち込みでは、下で自社のAIのキーを登録するとAIが使えるようになります。それまでは決まったルールで動きます。"
                : "このサービスのAIがまだ準備中です。決まったルールで動きます(運営者の方へ: ANTHROPIC_API_KEY を設定してください)。"}
          </p>
        </div>
      </section>

      {error && <p className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</p>}
      {message && <p className="rounded-md bg-indigo-50 px-4 py-2 text-sm text-indigo-800">{message}</p>}

      <section className="space-y-3">
        <h2 className="font-semibold">AIの使い方</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {MODES.map((m) => {
            const selected = data.mode === m.key;
            return (
              <button
                key={m.key}
                type="button"
                disabled={busy || selected || data.locked}
                onClick={() => send({ action: "mode", mode: m.key }, `${m.name}に切り替えました`)}
                className={`rounded-xl border p-4 text-left transition disabled:cursor-default ${selected ? "border-indigo-400 bg-white ring-2 ring-indigo-200" : "border-slate-200 bg-white hover:border-indigo-300 disabled:opacity-60"}`}
              >
                <span className="flex items-center justify-between">
                  <span className="font-medium">{m.name}</span>
                  {selected && <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-xs text-white">選択中</span>}
                </span>
                <span className="mt-1 block text-sm text-slate-600">{m.text}</span>
              </button>
            );
          })}
        </div>
        <p className="text-xs text-slate-500">
          {data.locked ? (
            <>
              ご契約中は、申し込んだプランの使い方になります。切り替えるときは
              <Link href="/billing" className="mx-1 text-indigo-700 hover:underline">
                契約・お支払い
              </Link>
              の「お支払い情報の管理」からプランを変えてください。
            </>
          ) : (
            <>
              申し込むときに、AI込みとAI持ち込みのどちらかを選びます(料金は
              <Link href="/pricing" className="mx-1 text-indigo-700 hover:underline">
                料金プラン
              </Link>
              )。
            </>
          )}
        </p>
      </section>

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-semibold">自社のAIのキー(AI持ち込み)</h2>
        <p className="text-sm text-slate-600">
          Anthropic のコンソール(console.anthropic.com)で作った API キーを登録します。キーは暗号化して保存し、画面には末尾の4文字だけを表示します。
          {data.mode !== "BYO" && " AI込みの間は使いません。"}
        </p>
        {data.hasKey && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-4 py-3 text-sm">
            <span>
              登録済み: <span className="font-mono">sk-ant-…{data.keyHint}</span>
              {data.keySetAt && <span className="ml-2 text-slate-500">({formatDate(data.keySetAt)} 登録)</span>}
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() => confirm("登録したキーを削除しますか?(AI持ち込みでは、AIを使わずに動くようになります)") && send({ action: "clear" }, "キーを削除しました")}
              className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              削除
            </button>
          </div>
        )}
        <form onSubmit={saveKey} className="flex flex-col gap-2 sm:flex-row">
          <input
            type="password"
            autoComplete="off"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="sk-ant-..."
            className="flex-1 rounded-md border border-slate-300 px-3 py-2 font-mono text-sm"
          />
          <button type="submit" disabled={busy || !key.trim()} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
            {busy ? "確かめています..." : data.hasKey ? "キーを入れ替える" : "キーを登録"}
          </button>
        </form>
        <p className="text-xs text-slate-500">登録するときに、AIにつながるかを短く確かめます。AIの利用料は Anthropic から自社に請求されます。</p>
      </section>
    </div>
  );
}

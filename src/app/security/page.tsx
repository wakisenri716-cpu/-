"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { formatDate } from "@/lib/format";

type Settings = { require2fa: boolean; sessionIdleMinutes: number | null; allowedIps: string | null; loginAlert: boolean };
type Row = { id: string; name: string; email: string; role: string; active: boolean; totp: boolean; hasPassword: boolean; lastSeen: string | null; locked: boolean; failedLogins: number };
type Data = { settings: Settings; rows: Row[]; checks: { ok: boolean; label: string; detail: string }[]; currentIp: string | null };

const IDLE = [
  [null, "しない(30日)"],
  [15, "15分"],
  [30, "30分"],
  [60, "1時間"],
  [120, "2時間"],
  [480, "8時間"],
  [1440, "1日"],
] as const;
const ROLE: Record<string, string> = { ADMIN: "管理者", ACCOUNTANT: "経理担当", EMPLOYEE: "従業員", ADVISOR: "税理士(閲覧のみ)" };

export default function SecurityPage() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/security");
    const body = await res.json();
    if (!res.ok) setError(body.error || "読み込めませんでした");
    else setData(body);
  }, []);

  useEffect(() => {
    // Fetch-on-mount: setState always lands after the fetch's await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    if (f.get("require2fa") === "on" && !data?.settings.require2fa && !confirm("2段階認証を必須にすると、まだ設定していない人は設定するまでほかの画面を使えなくなります。よろしいですか?")) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    const res = await fetch("/api/security", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        require2fa: f.get("require2fa") === "on",
        loginAlert: f.get("loginAlert") === "on",
        sessionIdleMinutes: f.get("idle") === "" ? null : Number(f.get("idle")),
        allowedIps: f.get("allowedIps"),
      }),
    });
    const body = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(body.error || "保存できませんでした");
      return;
    }
    setMessage("安全の設定を保存しました");
    await load();
  }

  const s = data?.settings;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">安全の設定</h1>
        <p className="mt-1 text-sm text-slate-600">
          この会社のデータを守るための設定と、いまの状態の点検です。設定はこの会社だけに効きます(ほかの会社は、その会社を開いて設定してください)。
        </p>
      </div>

      {error && <div className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</div>}
      {message && <div className="rounded-md bg-emerald-50 px-4 py-2 text-sm text-emerald-800">{message}</div>}

      {data && (
        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <h2 className="border-b px-4 py-3 font-semibold">点検</h2>
          <ul className="divide-y">
            {data.checks.map((c) => (
              <li key={c.label} className="flex items-start gap-2 px-4 py-3 text-sm">
                <span className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${c.ok ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}`}>
                  {c.ok ? "✓" : "!"}
                </span>
                <div>
                  <div className="font-medium">{c.label}</div>
                  <div className="text-slate-600">{c.detail}</div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {s && (
        <form key={JSON.stringify(s)} onSubmit={save} className="space-y-5 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="font-semibold">設定</h2>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="require2fa" defaultChecked={s.require2fa} className="mt-1" />
            <span>
              <span className="font-medium">全員に2段階認証を必須にする</span>
              <span className="block text-slate-500">まだ設定していない人は、次に開いたときに設定するまで「アカウント」の画面しか使えなくなります。</span>
            </span>
          </label>
          <label className="block text-sm">
            <span className="font-medium">操作しないときの自動ログアウト</span>
            <select name="idle" defaultValue={s.sessionIdleMinutes ?? ""} className="mt-1 block rounded-md border px-3 py-2">
              {IDLE.map(([m, label]) => (
                <option key={label} value={m ?? ""}>
                  {label}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-slate-500">共用のパソコンやお店の端末で使うときにおすすめです。</span>
          </label>
          <label className="block text-sm">
            <span className="font-medium">使える場所(IPアドレス)の制限</span>
            <textarea
              name="allowedIps"
              rows={4}
              defaultValue={s.allowedIps ?? ""}
              placeholder={"例:\n203.0.113.5\n198.51.100.0/24"}
              className="mt-1 block w-full rounded-md border px-3 py-2 font-mono text-sm"
            />
            <span className="mt-1 block text-slate-500">
              1行に1つ(範囲は「/24」のように書けます)。空にすると、どこからでも使えます。事務所の固定IPなどを入れると、それ以外の場所からはこの会社を開けなくなります。
              今お使いの場所: <span className="font-mono">{data?.currentIp ?? "不明"}</span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="loginAlert" defaultChecked={s.loginAlert} className="mt-1" />
            <span>
              <span className="font-medium">新しい端末からログインしたら、本人にメールで知らせる</span>
              <span className="block text-slate-500">
                パスワードが漏れて、知らない人がログインしたときに気づけます(送り方は「
                <Link href="/email" className="text-indigo-700 hover:underline">
                  メール設定
                </Link>
                」)。
              </span>
            </span>
          </label>
          <button disabled={busy} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
            保存する
          </button>
        </form>
      )}

      {data && (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <h2 className="border-b px-4 py-3 font-semibold">メンバーの状態</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs whitespace-nowrap text-slate-500">
                <tr>
                  <th className="px-4 py-2">名前</th>
                  <th className="px-4 py-2">権限</th>
                  <th className="px-4 py-2">2段階認証</th>
                  <th className="px-4 py-2">最後に使った日</th>
                  <th className="px-4 py-2">状態</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.rows.map((r) => (
                  <tr key={r.id} className={r.active ? "" : "text-slate-400"}>
                    <td className="px-4 py-2">
                      <div className="font-medium whitespace-nowrap">{r.name}</div>
                      <div className="text-xs text-slate-500">{r.email}</div>
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">{ROLE[r.role] ?? r.role}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{r.totp ? <span className="text-emerald-700">設定済み</span> : <span className="text-amber-700">未設定</span>}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{r.lastSeen ? formatDate(r.lastSeen) : "-"}</td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      {!r.active ? "停止中" : r.locked ? <span className="text-rose-700">ロック中</span> : r.failedLogins ? `ログイン失敗 ${r.failedLogins}回` : "利用中"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t px-4 py-2 text-xs text-slate-500">
            権限の変更・利用停止・2段階認証の解除は「
            <Link href="/users" className="text-indigo-700 hover:underline">
              ユーザー管理
            </Link>
            」、だれが何をしたかは「
            <Link href="/audit" className="text-indigo-700 hover:underline">
              操作ログ
            </Link>
            」で確認できます。
          </p>
        </section>
      )}
    </div>
  );
}

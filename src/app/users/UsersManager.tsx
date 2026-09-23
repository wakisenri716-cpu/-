"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { formatDate } from "@/lib/format";

type Role = "ADMIN" | "ACCOUNTANT" | "EMPLOYEE";
type User = { id: string; name: string; email: string; role: Role; active: boolean; hasPassword: boolean; createdAt: string };

const ROLE_LABELS: Record<Role, string> = { ADMIN: "管理者", ACCOUNTANT: "経理担当", EMPLOYEE: "従業員" };
const inputClass = "w-full rounded-md border px-2.5 py-1.5 text-sm";

export function UsersManager({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<User[]>([]);
  const [resetFor, setResetFor] = useState<User | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/users");
    if (res.ok) setUsers(await res.json());
  }, []);

  useEffect(() => {
    // Fetch-on-mount: the resulting setState always lands after the fetch's
    // await, so the extra render this rule warns about never happens here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function send(url: string, method: string, body: object, success: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "保存に失敗しました");
      setMessage(success);
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function addUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    if (await send("/api/users", "POST", data, `${data.name}さんを追加しました。メールアドレスと初期パスワードを本人に伝えてください`)) form.reset();
  }

  async function resetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!resetFor) return;
    const password = String(new FormData(event.currentTarget).get("password") ?? "");
    if (await send(`/api/users/${resetFor.id}`, "PATCH", { password }, `${resetFor.name}さんのパスワードを再設定しました`)) setResetFor(null);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">ユーザー管理</h1>
        <p className="mt-1 text-sm text-slate-600">
          アプリにログインできるメンバーを管理します。追加したメンバーには、メールアドレスと初期パスワードを伝えてください
          (本人は「アカウント」からパスワードを変更できます)。
        </p>
      </div>

      {error && <div className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</div>}
      {message && <div className="rounded-md bg-emerald-50 px-4 py-2 text-sm text-emerald-800">{message}</div>}

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="font-semibold">メンバーを追加</h2>
        <form onSubmit={addUser} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1.4fr_1fr_8rem_auto] lg:items-end">
          <div>
            <label className="mb-1 block text-xs text-slate-500">名前</label>
            <input name="name" required className={inputClass} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-500">メールアドレス</label>
            <input name="email" type="email" required className={inputClass} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-500">初期パスワード(8文字以上)</label>
            <input name="password" type="text" required minLength={8} autoComplete="off" className={inputClass} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-500">権限</label>
            <select name="role" defaultValue="EMPLOYEE" className={inputClass}>
              {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium whitespace-nowrap text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
          >
            追加
          </button>
        </form>
      </section>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs whitespace-nowrap uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2">名前</th>
                <th className="px-4 py-2">メールアドレス</th>
                <th className="px-4 py-2">権限</th>
                <th className="px-4 py-2">状態</th>
                <th className="px-4 py-2">登録日</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {users.map((u) => {
                const self = u.id === currentUserId;
                return (
                  <tr key={u.id} className={u.active ? "" : "text-slate-400"}>
                    <td className="px-4 py-2 whitespace-nowrap">
                      {u.name}
                      {self && <span className="ml-1 text-xs text-slate-400">(あなた)</span>}
                    </td>
                    <td className="px-4 py-2">{u.email}</td>
                    <td className="px-4 py-2">
                      <select
                        value={u.role}
                        disabled={busy || self}
                        onChange={(e) => send(`/api/users/${u.id}`, "PATCH", { role: e.target.value }, `${u.name}さんの権限を変更しました`)}
                        className="rounded-md border px-2 py-1 text-sm disabled:opacity-60"
                      >
                        {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      {!u.active ? (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">停止中</span>
                      ) : u.hasPassword ? (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">利用中</span>
                      ) : (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">パスワード未設定</span>
                      )}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">{formatDate(u.createdAt)}</td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      <button onClick={() => setResetFor(u)} disabled={busy} className="text-xs text-indigo-700 hover:underline">
                        {u.hasPassword ? "パスワード再設定" : "パスワード設定"}
                      </button>
                      {!self && (
                        <button
                          onClick={() =>
                            send(`/api/users/${u.id}`, "PATCH", { active: !u.active }, u.active ? `${u.name}さんを停止しました` : `${u.name}さんを再開しました`)
                          }
                          disabled={busy}
                          className="ml-3 text-xs text-slate-500 hover:underline"
                        >
                          {u.active ? "停止" : "再開"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-xs text-slate-500">
        「停止」したメンバーはログインできなくなり、ログイン中の端末も自動でログアウトされます。パスワードを再設定したときも同様です。
      </p>

      {resetFor && (
        <div className="fixed inset-0 z-20 flex items-end justify-center bg-slate-900/30 p-4 sm:items-center" onClick={() => setResetFor(null)}>
          <form onSubmit={resetPassword} onClick={(e) => e.stopPropagation()} className="w-full max-w-sm space-y-3 rounded-xl bg-white p-5 shadow-xl">
            <h2 className="font-semibold">{resetFor.name}さんのパスワードを設定</h2>
            <input name="password" type="text" required minLength={8} autoComplete="off" placeholder="新しいパスワード(8文字以上)" className={inputClass} />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setResetFor(null)} className="rounded-md border px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
                キャンセル
              </button>
              <button type="submit" disabled={busy} className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
                設定
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

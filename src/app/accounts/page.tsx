"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";

type Account = { id: string; code: string; name: string; category: keyof typeof CATEGORY; hidden: boolean; lineCount: number };

const CATEGORY = { ASSET: "資産", LIABILITY: "負債", EQUITY: "純資産", REVENUE: "収益", EXPENSE: "費用" } as const;

function categoryFor(code: string) {
  const head = code[0];
  return head === "1" ? "資産" : head === "2" ? "負債" : head === "3" ? "純資産" : head === "4" ? "収益" : /[5-9]/.test(head ?? "") ? "費用" : "";
}

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/chart-of-accounts");
    setAccounts(res.ok ? await res.json() : []);
  }, []);

  useEffect(() => {
    // Fetch-on-mount: setState always lands after the fetch's await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function call(url: string, init: RequestInit, success: string) {
    setBusy(true);
    setMessage(null);
    const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setMessage({ ok: false, text: body.error || "処理に失敗しました" });
      return false;
    }
    setMessage({ ok: true, text: success });
    await load();
    return true;
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await call("/api/chart-of-accounts", { method: "POST", body: JSON.stringify({ code, name }) }, `${code} ${name} を追加しました`)) {
      setCode("");
      setName("");
    }
  }

  const visible = (accounts ?? []).filter((a) => showHidden || !a.hidden);
  const hiddenCount = (accounts ?? []).filter((a) => a.hidden).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">勘定科目</h1>
        <p className="mt-1 text-sm text-slate-600">
          会社に合わせて勘定科目を追加したり、名前を変えたりできます。使わない科目は「非表示」にすると入力画面の選択肢から消えます(過去の仕訳や帳票には残ります)。
        </p>
      </div>

      {message && (
        <div className={`rounded-md px-4 py-2 text-sm ${message.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"}`}>{message.text}</div>
      )}

      <form onSubmit={add} className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <label className="text-xs text-slate-500">
          科目コード(4桁)
          <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" maxLength={4} required placeholder="5200" className="mt-1 block w-28 rounded-md border px-2 py-1.5 text-sm text-slate-900" />
        </label>
        <label className="text-xs text-slate-500">
          科目名
          <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="例: 車両費" className="mt-1 block w-48 rounded-md border px-2 py-1.5 text-sm text-slate-900" />
        </label>
        <span className="pb-2 text-xs text-slate-500">区分: {categoryFor(code) || "コードの先頭で決まります"}</span>
        <button type="submit" disabled={busy} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50">
          追加
        </button>
        <p className="w-full text-xs text-slate-500">コードの先頭が 1 なら資産、2 負債、3 純資産、4 収益、5〜9 費用になります。</p>
      </form>

      {hiddenCount > 0 && (
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} />
          非表示の科目も表示する({hiddenCount}件)
        </label>
      )}

      {accounts === null ? (
        <p className="text-sm text-slate-500">読み込み中...</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs whitespace-nowrap text-slate-500">
                <tr>
                  <th className="px-4 py-2">コード</th>
                  <th className="px-4 py-2">科目名</th>
                  <th className="px-4 py-2">区分</th>
                  <th className="px-4 py-2 text-right">使用中の仕訳</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {visible.map((a) => (
                  <tr key={a.id} className={a.hidden ? "text-slate-400" : ""}>
                    <td className="px-4 py-2 tabular-nums">{a.code}</td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      {editing?.id === a.id ? (
                        <form
                          onSubmit={async (e) => {
                            e.preventDefault();
                            if (await call(`/api/chart-of-accounts/${a.id}`, { method: "PATCH", body: JSON.stringify({ name: editing.name }) }, "名前を変更しました")) setEditing(null);
                          }}
                          className="flex items-center gap-2"
                        >
                          <input value={editing.name} onChange={(e) => setEditing({ id: a.id, name: e.target.value })} autoFocus className="w-40 rounded-md border px-2 py-1 text-sm text-slate-900" aria-label="科目名" />
                          <button type="submit" disabled={busy} className="text-xs font-medium text-indigo-700 hover:underline">
                            保存
                          </button>
                          <button type="button" onClick={() => setEditing(null)} className="text-xs text-slate-500 hover:underline">
                            やめる
                          </button>
                        </form>
                      ) : (
                        <>
                          <Link href={`/ledger?accountId=${a.id}`} className="hover:underline">
                            {a.name}
                          </Link>
                          {a.hidden && <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs">非表示</span>}
                        </>
                      )}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">{CATEGORY[a.category]}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{a.lineCount ? `${a.lineCount}行` : "-"}</td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      <button onClick={() => setEditing({ id: a.id, name: a.name })} className="mr-3 text-xs text-indigo-700 hover:underline">
                        名前を変更
                      </button>
                      <button
                        onClick={() => call(`/api/chart-of-accounts/${a.id}`, { method: "PATCH", body: JSON.stringify({ hidden: !a.hidden }) }, a.hidden ? `${a.name}を表示に戻しました` : `${a.name}を非表示にしました`)}
                        disabled={busy}
                        className="text-xs text-slate-600 hover:underline"
                      >
                        {a.hidden ? "表示に戻す" : "非表示"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

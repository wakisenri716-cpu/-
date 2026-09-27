"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { formatDate, formatYen } from "@/lib/format";

type Account = { bankCode: string; bankName: string; branchCode: string; branchName: string; accountType: string; accountNumber: string; holder?: string };
type Source = Account & { requesterCode: string; requesterName: string };
type Overview = {
  source: Source | null;
  staff: { id: string; name: string; account: Account | null }[];
  vendors: { id: string; name: string; account: Account | null }[];
  payrollMonths: { month: string; people: number; total: number; hasDetails: boolean }[];
  unpaid: { id: string; invoiceNumber: string | null; vendorId: string | null; vendorName: string; hasAccount: boolean; dueDate: string | null; remaining: number }[];
};
type Preview = { lines: { name: string; amount: number; account: Account | null; note: string }[]; total: number; missing: string[] };
type Editing = { kind: "staff" | "vendor" | "source"; id: string; name: string; account: Partial<Source> | null };

const inputClass = "mt-1 w-full rounded-md border px-3 py-2 text-sm";
const TYPE: Record<string, string> = { "1": "普通", "2": "当座" };
const accountText = (a: Account) => `${a.bankName} ${a.branchName} ${TYPE[a.accountType] ?? ""} ${a.accountNumber}${a.holder ? ` ${a.holder}` : ""}`;

function nextBusinessDay() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function TransfersPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [tab, setTab] = useState<"SALARY" | "GENERAL">("SALARY");
  const [month, setMonth] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [date, setDate] = useState(nextBusinessDay);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/transfers");
    if (!res.ok) return;
    const body: Overview = await res.json();
    setData(body);
    setMonth((m) => m || body.payrollMonths[0]?.month || "");
  }, []);

  useEffect(() => {
    // Fetch-on-mount: setState always lands after the fetch's await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const request = tab === "SALARY" ? { kind: "SALARY", month } : { kind: "GENERAL", invoiceIds: selected };
  const ready = tab === "SALARY" ? !!month : selected.length > 0;
  const requestKey = JSON.stringify(request);

  useEffect(() => {
    if (!ready) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPreview(null);
      return;
    }
    let cancelled = false;
    fetch("/api/transfers/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: requestKey })
      .then((r) => r.json().then((b) => ({ ok: r.ok, b })))
      .then(({ ok, b }) => {
        if (cancelled) return;
        if (ok) setPreview(b);
        else {
          setPreview(null);
          setError(b.error);
        }
      });
    return () => {
      cancelled = true;
    };
    // data を読み直したとき(口座を登録したとき)も作り直す
  }, [requestKey, ready, data]);

  async function download() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/transfers/file", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...request, date }) });
      if (!res.ok) throw new Error((await res.json()).error || "作れませんでした");
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "zengin.txt";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
      setMessage(`振込データ(${name})を作りました。ネットバンキングの「振込ファイルの取込」から読み込んでください。`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
    } finally {
      setBusy(false);
    }
  }

  async function saveAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const f = Object.fromEntries(new FormData(event.currentTarget));
    setBusy(true);
    setError(null);
    const res =
      editing.kind === "source"
        ? await fetch("/api/transfers/source", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) })
        : await fetch("/api/transfers/payee", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: editing.kind, id: editing.id, account: f }) });
    const body = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(body.error || "保存できませんでした");
      return;
    }
    setMessage(`${editing.name}の口座を保存しました`);
    setEditing(null);
    await load();
  }

  async function removeAccount(kind: "staff" | "vendor", id: string, name: string) {
    if (!confirm(`${name}の振込先を消しますか?`)) return;
    await fetch("/api/transfers/payee", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, id, account: null }) });
    await load();
  }

  const unpaidVendors = new Set(data?.unpaid.map((u) => u.vendorId));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">振込データ</h1>
        <p className="mt-1 text-sm text-slate-600">
          給料や取引先への支払いを、ネットバンキングにまとめて読み込める「全銀フォーマット」のファイルにします。1件ずつ振込先を入力する手間と、打ち間違いがなくなります。
          振り込んだお金は、あとで銀行明細を取り込むと記帳されます。
        </p>
      </div>

      {error && <div className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</div>}
      {message && <div className="rounded-md bg-emerald-50 px-4 py-2 text-sm text-emerald-800">{message}</div>}

      {data && (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="min-w-0">
            <div className="text-xs text-slate-500">振込元の口座(会社の口座)</div>
            {data.source ? (
              <div className="text-sm font-medium break-all">
                {accountText(data.source)} ・ 委託者 {data.source.requesterName}({data.source.requesterCode})
              </div>
            ) : (
              <div className="text-sm text-amber-700">まだ登録していません。最初に登録してください。</div>
            )}
          </div>
          <button
            onClick={() => setEditing({ kind: "source", id: "", name: "振込元", account: data.source })}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            {data.source ? "変更" : "登録する"}
          </button>
        </section>
      )}

      <div className="flex gap-2 border-b">
        {(
          [
            ["SALARY", "給与振込"],
            ["GENERAL", "総合振込(請求書の支払い)"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => {
              setTab(key);
              setError(null);
              setMessage(null);
            }}
            className={`px-3 py-2 text-sm font-medium ${tab === key ? "border-b-2 border-indigo-600 text-indigo-700" : "text-slate-500"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {data && (
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-end gap-3">
            {tab === "SALARY" ? (
              <label className="text-sm">
                <span className="text-slate-600">給料の月(計上済み)</span>
                <select value={month} onChange={(e) => setMonth(e.target.value)} className={`${inputClass} w-auto`}>
                  {data.payrollMonths.length === 0 && <option value="">計上した月がありません</option>}
                  {data.payrollMonths.map((m) => (
                    <option key={m.month} value={m.month}>
                      {m.month.replace("-", "年")}月分({m.people}人・{formatYen(m.total)})
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <div className="w-full">
                <div className="mb-1 text-sm text-slate-600">支払う請求書を選んでください(同じ取引先はまとめて1回の振込にします)</div>
                <ul className="max-h-72 divide-y overflow-y-auto rounded-lg border">
                  {data.unpaid.map((u) => (
                    <li key={u.id}>
                      <label className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm hover:bg-slate-50">
                        <input
                          type="checkbox"
                          checked={selected.includes(u.id)}
                          onChange={(e) => setSelected((prev) => (e.target.checked ? [...prev, u.id] : prev.filter((x) => x !== u.id)))}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="font-medium">{u.vendorName}</span>
                          <span className="ml-2 text-xs text-slate-500">
                            {u.invoiceNumber ?? "番号なし"}
                            {u.dueDate && ` ・ 期日 ${formatDate(u.dueDate)}`}
                          </span>
                          {!u.hasAccount && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">振込先未登録</span>}
                        </span>
                        <span className="font-semibold tabular-nums">{formatYen(u.remaining)}</span>
                      </label>
                    </li>
                  ))}
                  {data.unpaid.length === 0 && <li className="px-3 py-4 text-center text-slate-400">未払いの請求書はありません</li>}
                </ul>
              </div>
            )}
            <label className="text-sm">
              <span className="text-slate-600">振込日</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${inputClass} w-auto`} />
            </label>
          </div>

          {preview && (
            <div className="space-y-3">
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs whitespace-nowrap text-slate-500">
                    <tr>
                      <th className="px-3 py-2">振込先</th>
                      <th className="px-3 py-2">口座</th>
                      <th className="px-3 py-2 text-right">金額</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {preview.lines.map((l, i) => (
                      <tr key={i}>
                        <td className="px-3 py-2">
                          <div className="font-medium whitespace-nowrap">{l.name}</div>
                          <div className="text-xs text-slate-500">{l.note}</div>
                        </td>
                        <td className="px-3 py-2 text-xs">{l.account ? accountText(l.account) : <span className="text-amber-700">口座が未登録です(下で登録してください)</span>}</td>
                        <td className="px-3 py-2 text-right font-medium whitespace-nowrap tabular-nums">{formatYen(l.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t bg-slate-50 font-semibold">
                      <td className="px-3 py-2" colSpan={2}>
                        合計 {preview.lines.length}件
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatYen(preview.total)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <button
                onClick={download}
                disabled={busy || !data.source || preview.missing.length > 0}
                className="rounded-md bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
              >
                振込データをダウンロード
              </button>
              {(!data.source || preview.missing.length > 0) && (
                <p className="text-xs text-amber-700">
                  {!data.source ? "振込元の口座を登録すると作れます。" : `${preview.missing.join("・")}の振込先の口座を登録すると作れます。`}
                </p>
              )}
            </div>
          )}
        </section>
      )}

      {data && (
        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <h2 className="border-b px-4 py-3 font-semibold">振込先の口座</h2>
          <ul className="divide-y text-sm">
            {[
              ...data.staff.map((s) => ({ kind: "staff" as const, ...s, label: "スタッフ" })),
              ...data.vendors.filter((v) => v.account || unpaidVendors.has(v.id)).map((v) => ({ kind: "vendor" as const, ...v, label: "取引先" })),
            ].map((p) => (
              <li key={`${p.kind}-${p.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                <div className="min-w-0">
                  <span className="mr-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{p.label}</span>
                  <span className="font-medium">{p.name}</span>
                  <div className={`text-xs break-all ${p.account ? "text-slate-500" : "text-amber-700"}`}>{p.account ? accountText(p.account) : "未登録"}</div>
                </div>
                <div className="flex gap-3 text-xs">
                  <button onClick={() => setEditing({ kind: p.kind, id: p.id, name: p.name, account: p.account })} className="text-indigo-700 hover:underline">
                    {p.account ? "変更" : "登録"}
                  </button>
                  {p.account && (
                    <button onClick={() => removeAccount(p.kind, p.id, p.name)} className="text-slate-500 hover:text-rose-700 hover:underline">
                      削除
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {editing && (
        <div className="fixed inset-0 z-20 flex items-end justify-center bg-slate-900/30 p-4 sm:items-center" onClick={() => setEditing(null)}>
          <form onSubmit={saveAccount} onClick={(e) => e.stopPropagation()} className="max-h-[90vh] w-full max-w-lg space-y-3 overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
            <h2 className="font-semibold">{editing.kind === "source" ? "振込元の口座(会社の口座)" : `${editing.name}の振込先の口座`}</h2>
            {editing.kind === "source" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="text-slate-600">委託者コード(依頼人コード)</span>
                  <input name="requesterCode" required defaultValue={editing.account?.requesterCode ?? ""} inputMode="numeric" className={inputClass} />
                </label>
                <label className="block text-sm">
                  <span className="text-slate-600">委託者名(カタカナ)</span>
                  <input name="requesterName" required defaultValue={editing.account?.requesterName ?? ""} placeholder="例: カ)サンプル" className={inputClass} />
                </label>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="text-slate-600">金融機関コード(4桁)</span>
                <input name="bankCode" required defaultValue={editing.account?.bankCode ?? ""} inputMode="numeric" maxLength={4} placeholder="例: 0001" className={inputClass} />
              </label>
              <label className="block text-sm">
                <span className="text-slate-600">金融機関名(カタカナ)</span>
                <input name="bankName" required defaultValue={editing.account?.bankName ?? ""} placeholder="例: ミズホ" className={inputClass} />
              </label>
              <label className="block text-sm">
                <span className="text-slate-600">支店コード(3桁)</span>
                <input name="branchCode" required defaultValue={editing.account?.branchCode ?? ""} inputMode="numeric" maxLength={3} placeholder="例: 001" className={inputClass} />
              </label>
              <label className="block text-sm">
                <span className="text-slate-600">支店名(カタカナ)</span>
                <input name="branchName" required defaultValue={editing.account?.branchName ?? ""} placeholder="例: トウキヨウエイギヨウブ" className={inputClass} />
              </label>
              <label className="block text-sm">
                <span className="text-slate-600">預金の種類</span>
                <select name="accountType" defaultValue={editing.account?.accountType ?? "1"} className={inputClass}>
                  <option value="1">普通</option>
                  <option value="2">当座</option>
                </select>
              </label>
              <label className="block text-sm">
                <span className="text-slate-600">口座番号(7桁まで)</span>
                <input name="accountNumber" required defaultValue={editing.account?.accountNumber ?? ""} inputMode="numeric" maxLength={7} className={inputClass} />
              </label>
            </div>
            {editing.kind !== "source" && (
              <label className="block text-sm">
                <span className="text-slate-600">口座名義(カタカナ)</span>
                <input name="holder" required defaultValue={editing.account?.holder ?? ""} placeholder="例: ヤマダ タロウ" className={inputClass} />
              </label>
            )}
            <p className="text-xs text-slate-500">
              カタカナ・ひらがなで入力すると、振込データ用の半角カナに自動で直します(小さい「ッ」「ャ」は大きい文字になります)。金融機関コード・支店コードは通帳やキャッシュカード、銀行のホームページで確かめられます。
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(null)} className="rounded-md border px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
                やめる
              </button>
              <button disabled={busy} className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
                保存
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

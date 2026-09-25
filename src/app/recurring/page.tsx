"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { formatYen } from "@/lib/format";
import { PrintButton } from "@/components/PrintButton";

type Account = { id: string; code: string; name: string };
type Entry = {
  id: string;
  name: string;
  description: string;
  dayOfMonth: number;
  startMonth: string;
  endMonth: string | null;
  active: boolean;
  amount: number;
  lines: { accountId: string; account: Account; debit: number; credit: number }[];
  lastPosted: string | null;
  due: string[];
};
type Line = { accountId: string; debit: string; credit: string };
type Draft = { id: string | null; name: string; description: string; dayOfMonth: string; startMonth: string; endMonth: string; lines: Line[] };

// よくある定期取引のひな形(科目コードで指定し、金額だけ入れれば登録できる)
// 科目は「借方…, 貸方」の順。金額は入力してもらう。
const TEMPLATES: { label: string; name: string; codes: string[] }[] = [
  { label: "家賃の支払", name: "事務所家賃", codes: ["5060", "1020"] },
  { label: "通信費(ネット・電話)", name: "インターネット回線", codes: ["5040", "1020"] },
  { label: "借入金の返済", name: "借入金の返済", codes: ["2210", "5150", "1020"] },
  { label: "サブスク・手数料", name: "クラウドサービス利用料", codes: ["5080", "1020"] },
];

const inputClass = "w-full rounded-md border px-2 py-1.5 text-sm";

function thisMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(m: string) {
  return `${m.slice(0, 4)}年${Number(m.slice(5))}月`;
}

function dayLabel(d: number) {
  return d === 0 ? "毎月末" : `毎月${d}日`;
}

const emptyDraft = (): Draft => ({
  id: null,
  name: "",
  description: "",
  dayOfMonth: "25",
  startMonth: thisMonth(),
  endMonth: "",
  lines: [
    { accountId: "", debit: "", credit: "" },
    { accountId: "", debit: "", credit: "" },
  ],
});

export default function RecurringPage() {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/recurring");
    const body = res.ok ? await res.json() : { entries: [], accounts: [] };
    setEntries(body.entries);
    setAccounts(body.accounts);
  }, []);

  useEffect(() => {
    // Fetch-on-mount: setState always lands after the fetch's await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function call(url: string, init: RequestInit, success: string | ((body: Record<string, unknown>) => string)) {
    setBusy(true);
    setMessage(null);
    const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setMessage({ ok: false, text: body.error || "処理に失敗しました" });
      return false;
    }
    setMessage({ ok: true, text: typeof success === "string" ? success : success(body) });
    await load();
    return true;
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    const payload = {
      ...draft,
      dayOfMonth: Number(draft.dayOfMonth),
      lines: draft.lines.map((l) => ({ accountId: l.accountId, debit: Number(l.debit || 0), credit: Number(l.credit || 0) })),
    };
    const ok = await call(
      draft.id ? `/api/recurring/${draft.id}` : "/api/recurring",
      { method: draft.id ? "PUT" : "POST", body: JSON.stringify(payload) },
      `「${draft.name}」を保存しました`,
    );
    if (ok) setDraft(null);
  }

  function applyTemplate(t: (typeof TEMPLATES)[number]) {
    const byCode = new Map(accounts.map((a) => [a.code, a.id]));
    setDraft({
      ...emptyDraft(),
      name: t.name,
      description: t.name,
      lines: t.codes.map((code) => ({ accountId: byCode.get(code) ?? "", debit: "", credit: "" })),
    });
  }

  function edit(e: Entry) {
    setDraft({
      id: e.id,
      name: e.name,
      description: e.description,
      dayOfMonth: String(e.dayOfMonth),
      startMonth: e.startMonth,
      endMonth: e.endMonth ?? "",
      lines: e.lines.map((l) => ({ accountId: l.accountId, debit: l.debit ? String(l.debit) : "", credit: l.credit ? String(l.credit) : "" })),
    });
  }

  const totalDue = (entries ?? []).reduce((s, e) => s + e.due.length, 0);
  const debit = draft?.lines.reduce((s, l) => s + Number(l.debit || 0), 0) ?? 0;
  const credit = draft?.lines.reduce((s, l) => s + Number(l.credit || 0), 0) ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-2xl font-semibold">定期取引</h1>
            <PrintButton variant="outline" />
          </div>
          <p className="mt-1 text-sm text-slate-600">
            家賃・リース料・借入金の返済など、毎月同じ金額の取引を登録しておくと、記帳日が来たらボタン1つで仕訳を記帳できます。
          </p>
        </div>
        {!draft && (
          <button
            onClick={() => setDraft(emptyDraft())}
            className="self-start rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium whitespace-nowrap text-white shadow-sm hover:bg-indigo-700"
          >
            + 定期取引を登録
          </button>
        )}
      </div>

      {message && (
        <div className={`rounded-md px-4 py-2 text-sm ${message.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"}`}>{message.text}</div>
      )}

      {totalDue > 0 && !draft && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm text-amber-900">記帳日が来ている未記帳の定期取引が {totalDue} 件あります。</p>
          <button
            onClick={() =>
              call("/api/recurring/post-due", { method: "POST" }, (b) =>
                `${b.posted}件を記帳しました${Array.isArray(b.errors) && b.errors.length ? `(失敗: ${(b.errors as string[]).join(" / ")})` : ""}`,
              )
            }
            disabled={busy}
            className="rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
          >
            まとめて記帳する
          </button>
        </div>
      )}

      {draft && (
        <form onSubmit={save} className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="font-semibold">{draft.id ? "定期取引を編集" : "定期取引を登録"}</h2>
          {!draft.id && (
            <div className="flex flex-wrap gap-2">
              <span className="text-xs text-slate-500">ひな形:</span>
              {TEMPLATES.map((t) => (
                <button key={t.label} type="button" onClick={() => applyTemplate(t)} className="rounded-full border px-3 py-0.5 text-xs text-slate-700 hover:bg-slate-50">
                  {t.label}
                </button>
              ))}
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-xs text-slate-500">
              名前
              <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required className={`${inputClass} mt-1`} placeholder="例: 事務所家賃" />
            </label>
            <label className="text-xs text-slate-500">
              摘要(仕訳に表示)
              <input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} className={`${inputClass} mt-1`} placeholder="空欄なら名前と同じ" />
            </label>
            <label className="text-xs text-slate-500">
              記帳日
              <select value={draft.dayOfMonth} onChange={(e) => setDraft({ ...draft, dayOfMonth: e.target.value })} className={`${inputClass} mt-1`}>
                {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    毎月{d}日
                  </option>
                ))}
                <option value="0">毎月末</option>
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-slate-500">
                開始月
                <input type="month" value={draft.startMonth} onChange={(e) => setDraft({ ...draft, startMonth: e.target.value })} required className={`${inputClass} mt-1`} />
              </label>
              <label className="text-xs text-slate-500">
                終了月(任意)
                <input type="month" value={draft.endMonth} onChange={(e) => setDraft({ ...draft, endMonth: e.target.value })} className={`${inputClass} mt-1`} />
              </label>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[30rem] text-sm">
              <thead className="text-left text-xs text-slate-500">
                <tr>
                  <th className="pb-1 font-medium">勘定科目</th>
                  <th className="w-32 pb-1 pl-2 text-right font-medium">借方</th>
                  <th className="w-32 pb-1 pl-2 text-right font-medium">貸方</th>
                  <th className="w-6" />
                </tr>
              </thead>
              <tbody>
                {draft.lines.map((l, i) => {
                  const set = (patch: Partial<Line>) => setDraft({ ...draft, lines: draft.lines.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
                  return (
                    <tr key={i} className="hover:bg-transparent">
                      <td className="py-1">
                        <select value={l.accountId} onChange={(e) => set({ accountId: e.target.value })} className={inputClass} aria-label={`${i + 1}行目の勘定科目`}>
                          <option value="">選択してください</option>
                          {accounts.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.code} {a.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-1 pl-2">
                        <input type="number" min={0} value={l.debit} onChange={(e) => set({ debit: e.target.value, ...(e.target.value ? { credit: "" } : {}) })} className={`${inputClass} text-right`} aria-label={`${i + 1}行目の借方`} />
                      </td>
                      <td className="py-1 pl-2">
                        <input type="number" min={0} value={l.credit} onChange={(e) => set({ credit: e.target.value, ...(e.target.value ? { debit: "" } : {}) })} className={`${inputClass} text-right`} aria-label={`${i + 1}行目の貸方`} />
                      </td>
                      <td className="py-1 text-center">
                        {draft.lines.length > 2 && (
                          <button type="button" onClick={() => setDraft({ ...draft, lines: draft.lines.filter((_, j) => j !== i) })} className="text-slate-400 hover:text-rose-600" aria-label="行を削除">
                            ×
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="text-sm font-medium">
                  <td className="pt-2">
                    <button type="button" onClick={() => setDraft({ ...draft, lines: [...draft.lines, { accountId: "", debit: "", credit: "" }] })} className="text-xs font-medium text-indigo-700 hover:underline">
                      + 行を追加
                    </button>
                  </td>
                  <td className="pt-2 pl-2 text-right tabular-nums">{formatYen(debit)}</td>
                  <td className={`pt-2 pl-2 text-right tabular-nums ${debit !== credit ? "text-rose-600" : ""}`}>{formatYen(credit)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setDraft(null)} className="rounded-md border px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
              キャンセル
            </button>
            <button type="submit" disabled={busy} className="rounded-md bg-indigo-600 px-5 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50">
              保存する
            </button>
          </div>
        </form>
      )}

      {entries === null ? (
        <p className="text-sm text-slate-500">読み込み中...</p>
      ) : entries.length === 0 ? (
        !draft && <p className="rounded-xl border border-dashed p-6 text-center text-sm text-slate-500">まだ定期取引はありません。「+ 定期取引を登録」から追加してください。</p>
      ) : (
        <div className="space-y-3">
          {entries.map((e) => (
            <div key={e.id} className={`rounded-xl border bg-white p-4 shadow-sm ${e.active ? "border-slate-200" : "border-slate-200 opacity-60"}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{e.name}</span>
                    <span className="text-sm tabular-nums">{formatYen(e.amount)}</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{dayLabel(e.dayOfMonth)}</span>
                    {!e.active && <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-600">停止中</span>}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {e.lines.map((l) => `${l.debit ? "借" : "貸"} ${l.account.name} ${formatYen(l.debit || l.credit)}`).join(" / ")}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {monthLabel(e.startMonth)}から{e.endMonth ? `${monthLabel(e.endMonth)}まで` : ""}
                    {e.lastPosted ? ` ・ 最後に記帳: ${monthLabel(e.lastPosted)}分` : " ・ まだ記帳していません"}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  <button onClick={() => edit(e)} className="text-indigo-700 hover:underline">
                    編集
                  </button>
                  <button
                    onClick={() => call(`/api/recurring/${e.id}`, { method: "PATCH", body: JSON.stringify({ active: !e.active }) }, e.active ? `「${e.name}」を停止しました` : `「${e.name}」を再開しました`)}
                    className="text-slate-600 hover:underline"
                  >
                    {e.active ? "停止" : "再開"}
                  </button>
                  <button
                    onClick={() => window.confirm(`「${e.name}」を削除しますか?(記帳済みの仕訳は残ります)`) && call(`/api/recurring/${e.id}`, { method: "DELETE" }, `「${e.name}」を削除しました`)}
                    className="text-rose-600 hover:underline"
                  >
                    削除
                  </button>
                </div>
              </div>
              {e.due.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
                  <span className="text-xs text-amber-800">未記帳:</span>
                  {e.due.map((m) => (
                    <button
                      key={m}
                      onClick={() => call(`/api/recurring/${e.id}/post`, { method: "POST", body: JSON.stringify({ month: m }) }, `「${e.name}」${monthLabel(m)}分を記帳しました`)}
                      disabled={busy}
                      className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
                    >
                      {monthLabel(m)}分を記帳
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <p className="text-xs text-slate-500">
        記帳した仕訳は仕訳帳に「定期取引」として表示され、仕訳帳から取り消せます(取り消した月は、ここから記帳し直せます)。
      </p>
    </div>
  );
}

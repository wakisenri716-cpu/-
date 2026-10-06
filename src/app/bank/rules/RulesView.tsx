"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { formatDate, formatYen } from "@/lib/format";

type Rule = {
  id: string;
  keyword: string;
  direction: "OUT" | "IN" | "BOTH";
  minAmount: number | null;
  maxAmount: number | null;
  bankAccountId: string | null;
  bankAccountName: string | null;
  accountCode: string;
  accountName: string;
  autoPost: boolean;
  memo: string | null;
  active: boolean;
  hits: number;
  lastUsedAt: string | null;
};
type Account = { code: string; name: string; category: string };
type Bank = { id: string; name: string; kind: "BANK" | "CARD"; active: boolean; accountCode: string };
type Data = { rules: Rule[]; accounts: Account[]; banks: Bank[]; pending: number };
type Draft = { id?: string; keyword: string; direction: string; minAmount: string; maxAmount: string; bankAccountId: string; accountCode: string; autoPost: boolean; memo: string };
export type Preset = { keyword: string; direction: string; bankAccountId: string; accountCode: string } | null;

const DIRECTION_LABELS: Record<string, string> = { OUT: "出金・カードの利用", IN: "入金", BOTH: "両方" };
const CATEGORY_LABELS: [string, string][] = [
  ["EXPENSE", "費用"],
  ["REVENUE", "収益"],
  ["ASSET", "資産"],
  ["LIABILITY", "負債"],
  ["EQUITY", "純資産"],
];
const EMPTY: Draft = { keyword: "", direction: "OUT", minAmount: "", maxAmount: "", bankAccountId: "", accountCode: "", autoPost: true, memo: "" };
const inputClass = "mt-1 w-full rounded-md border px-3 py-2 text-sm";

function amountLabel(r: Rule) {
  if (r.minAmount == null && r.maxAmount == null) return "金額は問わない";
  if (r.minAmount != null && r.maxAmount != null) return r.minAmount === r.maxAmount ? `${formatYen(r.minAmount)}ちょうど` : `${formatYen(r.minAmount)}〜${formatYen(r.maxAmount)}`;
  return r.minAmount != null ? `${formatYen(r.minAmount)}以上` : `${formatYen(r.maxAmount!)}以下`;
}

export function RulesView({ preset }: { preset: Preset }) {
  const [data, setData] = useState<Data | null>(null);
  const [draft, setDraft] = useState<Draft | null>(preset ? { ...EMPTY, ...preset } : null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/bank/rules");
    if (res.ok) setData(await res.json());
  }, []);

  useEffect(() => {
    // Fetch-on-mount: setState always lands after the fetch's await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function send(url: string, method: string, body?: object) {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) setMessage({ ok: false, text: json.error || "処理できませんでした" });
    return res.ok ? json : null;
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setBusy(true);
    setMessage(null);
    const saved = await send(draft.id ? `/api/bank/rules/${draft.id}` : "/api/bank/rules", draft.id ? "PATCH" : "POST", draft);
    setBusy(false);
    if (!saved) return;
    setDraft(null);
    setMessage({ ok: true, text: `ルール「${saved.keyword}」を${draft.id ? "変更" : "登録"}しました。これから取り込む明細に使います。確認待ちの明細に使うときは「確認待ちの明細に当てはめる」を押してください。` });
    await load();
  }

  async function apply() {
    setBusy(true);
    setMessage(null);
    const r = await send("/api/bank/rules/apply", "POST");
    setBusy(false);
    if (r) setMessage({ ok: true, text: r.matched ? `確認待ち ${r.checked}件のうち ${r.matched}件がルールに当てはまりました(記帳 ${r.posted}件・科目の提案 ${r.suggested}件)。` : `確認待ち ${r.checked}件の中に、ルールに当てはまる明細はありませんでした。` });
    await load();
  }

  async function patch(rule: Rule, body: object) {
    setMessage(null);
    if (await send(`/api/bank/rules/${rule.id}`, "PATCH", body)) await load();
  }

  async function remove(rule: Rule) {
    if (!confirm(`ルール「${rule.keyword}」を削除しますか?(記帳済みの仕訳はそのままです)`)) return;
    setMessage(null);
    if (await send(`/api/bank/rules/${rule.id}`, "DELETE")) await load();
  }

  if (!data) return null;
  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const ownCode = draft?.bankAccountId ? data.banks.find((b) => b.id === draft.bankAccountId)?.accountCode : undefined;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/bank" className="text-sm text-indigo-700 hover:underline">
            ← 銀行・カード明細
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">自動仕訳ルール</h1>
          <p className="mt-1 text-sm text-slate-600">
            「摘要にこの言葉があったら、この科目で記帳する」というルールを登録できます。明細を取り込むとき、過去の記帳やAIの判定より先に使います。上から順に見て、最初に当てはまったルールを使います。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={apply} disabled={busy || !data.rules.length} className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            確認待ちの明細に当てはめる({data.pending}件)
          </button>
          <button onClick={() => setDraft({ ...EMPTY })} className="rounded-md bg-vermilion-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-vermilion-700">
            ルールを追加
          </button>
        </div>
      </div>

      {message && <div className={`rounded-md px-4 py-2 text-sm ${message.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"}`}>{message.text}</div>}

      {draft && (
        <form onSubmit={save} className="space-y-4 rounded-xl border border-indigo-200 bg-white p-4 shadow-sm">
          <h2 className="font-semibold">{draft.id ? "ルールを変更" : "ルールを追加"}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="text-slate-600">摘要にこの言葉があったら</span>
              <input value={draft.keyword} onChange={(e) => set({ keyword: e.target.value })} required maxLength={40} placeholder="例: ｺｳｻﾞﾌﾘｶｴ ﾔﾏﾀﾞﾌﾄﾞｳｻﾝ、AWS" className={inputClass} />
              <span className="mt-1 block text-xs text-slate-500">半角・全角、大文字・小文字の違いは気にしなくて大丈夫です。摘要の一部だけでも当てはまります。</span>
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">この科目で記帳する</span>
              <select value={draft.accountCode} onChange={(e) => set({ accountCode: e.target.value })} required className={inputClass}>
                <option value="">選んでください</option>
                {CATEGORY_LABELS.map(([category, label]) => (
                  <optgroup key={category} label={label}>
                    {data.accounts
                      .filter((a) => a.category === category && a.code !== ownCode)
                      .map((a) => (
                        <option key={a.code} value={a.code}>
                          {a.code} {a.name}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <fieldset className="text-sm">
              <legend className="text-slate-600">向き</legend>
              <div className="mt-2 flex flex-wrap gap-3">
                {Object.entries(DIRECTION_LABELS).map(([value, label]) => (
                  <label key={value} className="flex items-center gap-1">
                    <input type="radio" name="direction" checked={draft.direction === value} onChange={() => set({ direction: value })} /> {label}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="block text-sm">
              <span className="text-slate-600">口座・カード</span>
              <select value={draft.bankAccountId} onChange={(e) => set({ bankAccountId: e.target.value })} className={inputClass}>
                <option value="">すべての口座・カード</option>
                {data.banks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}({b.kind === "CARD" ? "カード" : "口座"}){b.active ? "" : "・しまった"}
                  </option>
                ))}
              </select>
            </label>
            <div className="text-sm">
              <span className="text-slate-600">金額(任意)</span>
              <div className="mt-1 flex items-center gap-2">
                <input value={draft.minAmount} onChange={(e) => set({ minAmount: e.target.value })} inputMode="numeric" placeholder="下限" className="w-full rounded-md border px-3 py-2" />
                <span className="text-slate-500">〜</span>
                <input value={draft.maxAmount} onChange={(e) => set({ maxAmount: e.target.value })} inputMode="numeric" placeholder="上限" className="w-full rounded-md border px-3 py-2" />
              </div>
              <span className="mt-1 block text-xs text-slate-500">同じ相手でも金額で科目を分けたいときに(例: 10万円以上は固定資産)。両方に同じ金額で「ちょうど」。</span>
            </div>
            <label className="block text-sm">
              <span className="text-slate-600">メモ(任意)</span>
              <input value={draft.memo} onChange={(e) => set({ memo: e.target.value })} maxLength={100} placeholder="例: 事務所の家賃" className={inputClass} />
            </label>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={draft.autoPost} onChange={(e) => set({ autoPost: e.target.checked })} className="mt-1" />
            <span>
              確認なしで記帳する
              <span className="block text-xs text-slate-500">外すと、科目を提案するだけで「確認待ち」に残します。チェックしても、自動化の設定で決めた金額の上限を超える明細は確認待ちになります。</span>
            </span>
          </label>
          <div className="flex gap-2">
            <button disabled={busy} className="rounded-md bg-vermilion-600 px-4 py-2 text-sm font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
              {draft.id ? "変更する" : "登録する"}
            </button>
            <button type="button" onClick={() => setDraft(null)} className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
              やめる
            </button>
          </div>
        </form>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs whitespace-nowrap text-slate-500">
              <tr>
                <th className="px-3 py-2">順番</th>
                <th className="px-3 py-2">摘要にこの言葉</th>
                <th className="px-3 py-2">条件</th>
                <th className="px-3 py-2">記帳する科目</th>
                <th className="px-3 py-2 text-right">使った回数</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.rules.map((r, i) => (
                <tr key={r.id} className={`align-top ${r.active ? "" : "text-slate-400"}`}>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className="mr-1 tabular-nums">{i + 1}</span>
                    <button onClick={() => patch(r, { move: "up" })} disabled={i === 0} aria-label="上へ" className="px-1 text-slate-500 hover:text-indigo-700 disabled:opacity-30">
                      ↑
                    </button>
                    <button onClick={() => patch(r, { move: "down" })} disabled={i === data.rules.length - 1} aria-label="下へ" className="px-1 text-slate-500 hover:text-indigo-700 disabled:opacity-30">
                      ↓
                    </button>
                  </td>
                  <td className="min-w-[10rem] px-3 py-2">
                    <span className="font-medium">{r.keyword}</span>
                    {r.memo && <span className="block text-xs text-slate-500">{r.memo}</span>}
                  </td>
                  <td className="min-w-[10rem] px-3 py-2 text-xs text-slate-600">
                    {DIRECTION_LABELS[r.direction]} / {amountLabel(r)}
                    <span className="block">{r.bankAccountId ? (r.bankAccountName ?? "(削除された口座)") : "すべての口座・カード"}</span>
                  </td>
                  <td className="min-w-[9rem] px-3 py-2">
                    {r.accountCode} {r.accountName}
                    <span className={`mt-0.5 block w-fit rounded-full px-2 py-0.5 text-xs ${r.autoPost ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>{r.autoPost ? "確認なしで記帳" : "提案だけ"}</span>
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <span className="tabular-nums">{r.hits}回</span>
                    {r.lastUsedAt && <span className="block text-xs text-slate-500">最後: {formatDate(r.lastUsedAt)}</span>}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <div className="flex justify-end gap-3 text-xs">
                      <button
                        onClick={() =>
                          setDraft({
                            id: r.id,
                            keyword: r.keyword,
                            direction: r.direction,
                            minAmount: r.minAmount?.toString() ?? "",
                            maxAmount: r.maxAmount?.toString() ?? "",
                            bankAccountId: r.bankAccountId ?? "",
                            accountCode: r.accountCode,
                            autoPost: r.autoPost,
                            memo: r.memo ?? "",
                          })
                        }
                        className="text-indigo-700 hover:underline"
                      >
                        編集
                      </button>
                      <button onClick={() => patch(r, { active: !r.active })} className="text-slate-500 hover:underline">
                        {r.active ? "止める" : "再開"}
                      </button>
                      <button onClick={() => remove(r)} className="text-slate-500 hover:text-rose-700 hover:underline">
                        削除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {data.rules.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-slate-400">
                    まだルールがありません。「ルールを追加」か、銀行・カード明細の確認待ちの「ルールにする」から作れます。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-slate-500">
        ルールより先に使うのは、請求書との消込(金額が一致する請求書)とカード代金の引落しの目印だけです。ルールに当てはまらない明細は、これまでどおり「過去に同じ摘要で記帳した科目 → よくあるキーワード(手数料・家賃など)→ AI」の順に判定します。
      </p>
    </div>
  );
}

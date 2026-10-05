"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatYen } from "@/lib/format";

type Contract = {
  id: string;
  title: string;
  counterparty: string | null;
  kind: string;
  startDate: string | null;
  endDate: string | null;
  autoRenew: boolean;
  renewalMonths: number | null;
  noticeDays: number | null;
  amount: number | null;
  amountPeriod: string | null;
  paymentTerms: string | null;
  keyPoints: string[];
  summary: string | null;
  status: string;
  mode: string;
  nextEnd: string | null;
  deadline: string | null;
  daysToDeadline: number | null;
  daysToEnd: number | null;
  file: { id: string; name: string; href: string } | null;
};

const PERIOD: Record<string, string> = { MONTHLY: "月額", YEARLY: "年額", ONCE: "一回" };
const ymd = (d: string | null) => (d ? d.replaceAll("-", "/") : "-");

function Due({ c }: { c: Contract }) {
  const d = c.daysToDeadline ?? c.daysToEnd;
  if (d === null || c.status !== "ACTIVE") return null;
  const label = c.daysToDeadline !== null ? "申し出期限" : "満了";
  const tone = d < 0 ? "bg-slate-100 text-slate-600" : d <= 30 ? "bg-rose-100 text-rose-700" : d <= 60 ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>{d < 0 ? `${label}を過ぎました` : `${label}まで${d}日`}</span>;
}

function Editor({ c, kinds, onDone }: { c: Contract; kinds: Record<string, string>; onDone: () => void }) {
  const router = useRouter();
  const [f, setF] = useState({ ...c });
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<Contract>) => setF((x) => ({ ...x, ...patch }));
  async function save() {
    setError(null);
    const res = await fetch(`/api/contracts/${c.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...f, keyPoints: f.keyPoints }) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return setError(json.error || "保存できませんでした");
    onDone();
    router.refresh();
  }
  const input = "mt-1 block w-full rounded-md border px-2 py-1.5 text-sm text-slate-900";
  return (
    <div className="mt-3 grid gap-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-500 sm:grid-cols-3">
      <label className="sm:col-span-2">
        契約の名前
        <input value={f.title} onChange={(e) => set({ title: e.target.value })} className={input} />
      </label>
      <label>
        種類
        <select value={f.kind} onChange={(e) => set({ kind: e.target.value })} className={input}>
          {Object.entries(kinds).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <label>
        相手
        <input value={f.counterparty ?? ""} onChange={(e) => set({ counterparty: e.target.value })} className={input} />
      </label>
      <label>
        開始日
        <input type="date" value={f.startDate ?? ""} onChange={(e) => set({ startDate: e.target.value || null })} className={input} />
      </label>
      <label>
        満了日
        <input type="date" value={f.endDate ?? ""} onChange={(e) => set({ endDate: e.target.value || null })} className={input} />
      </label>
      <label className="flex items-center gap-2 pt-5 text-sm text-slate-700">
        <input type="checkbox" checked={f.autoRenew} onChange={(e) => set({ autoRenew: e.target.checked })} />
        自動更新する
      </label>
      <label>
        更新期間(か月)
        <input type="number" min={1} value={f.renewalMonths ?? ""} onChange={(e) => set({ renewalMonths: e.target.value ? Number(e.target.value) : null })} className={input} />
      </label>
      <label>
        申し出は満了日の何日前まで
        <input type="number" min={0} value={f.noticeDays ?? ""} onChange={(e) => set({ noticeDays: e.target.value ? Number(e.target.value) : null })} className={input} />
      </label>
      <label>
        金額(円)
        <input type="number" min={0} value={f.amount ?? ""} onChange={(e) => set({ amount: e.target.value ? Number(e.target.value) : null })} className={input} />
      </label>
      <label>
        金額の単位
        <select value={f.amountPeriod ?? ""} onChange={(e) => set({ amountPeriod: e.target.value || null })} className={input}>
          <option value="">-</option>
          {Object.entries(PERIOD).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <label>
        支払条件
        <input value={f.paymentTerms ?? ""} onChange={(e) => set({ paymentTerms: e.target.value })} className={input} />
      </label>
      <label className="sm:col-span-3">
        気をつける条項(1行に1つ)
        <textarea rows={3} value={f.keyPoints.join("\n")} onChange={(e) => set({ keyPoints: e.target.value.split("\n") })} className={input} />
      </label>
      {error && <p className="text-sm text-rose-700 sm:col-span-3">{error}</p>}
      <div className="flex justify-end gap-2 sm:col-span-3">
        <button onClick={onDone} className="rounded-md border px-3 py-1.5 text-sm text-slate-700 hover:bg-white">
          やめる
        </button>
        <button onClick={save} className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700">
          保存
        </button>
      </div>
    </div>
  );
}

export function ContractsView({ contracts, kinds }: { contracts: Contract[]; kinds: Record<string, string> }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [showEnded, setShowEnded] = useState(false);

  async function upload(file: File) {
    setBusy(true);
    setMessage(null);
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/contracts", { method: "POST", body: form });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setMessage({ ok: false, text: json.error || "登録できませんでした" });
    setMessage({ ok: true, text: `「${json.contract.title}」を台帳に登録しました。${json.contract.mode === "claude" ? "AIが読み取った内容を確かめてください。" : "期間・金額を入力してください。"}` });
    router.refresh();
  }
  async function patch(id: string, body: Record<string, unknown>, method = "PATCH") {
    if (method === "DELETE" && !window.confirm("台帳から外します(契約書のファイルは書類フォルダに残ります)。よろしいですか?")) return;
    const res = await fetch(`/api/contracts/${id}`, { method, headers: { "Content-Type": "application/json" }, body: method === "DELETE" ? undefined : JSON.stringify(body) });
    if (!res.ok) return window.alert((await res.json().catch(() => ({}))).error || "できませんでした");
    router.refresh();
  }

  const shown = contracts.filter((c) => showEnded || c.status === "ACTIVE");
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-indigo-200 bg-white p-4 shadow-sm">
        <label className={`cursor-pointer rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 ${busy ? "pointer-events-none opacity-50" : ""}`}>
          {busy ? "AIが読み取っています…" : "契約書を入れる(PDF・写真)"}
          <input type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} disabled={busy} />
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={showEnded} onChange={(e) => setShowEnded(e.target.checked)} />
          終了した契約も見る
        </label>
      </div>
      {message && <div className={`rounded-md px-4 py-2 text-sm ${message.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"}`}>{message.text}</div>}

      {shown.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">台帳に契約はまだありません。</div>
      ) : (
        <ul className="space-y-3">
          {shown.map((c) => (
            <li key={c.id} className={`rounded-xl border bg-white p-4 shadow-sm ${c.status === "ACTIVE" ? "border-slate-200" : "border-slate-200 opacity-70"}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{kinds[c.kind] ?? c.kind}</span>
                    <span className="font-medium break-words">{c.title}</span>
                    {c.status !== "ACTIVE" && <span className="text-xs text-slate-500">(終了)</span>}
                    <Due c={c} />
                  </div>
                  {c.counterparty && <div className="text-sm text-slate-600">相手: {c.counterparty}</div>}
                </div>
                {c.amount !== null && (
                  <div className="text-right">
                    <div className="font-semibold tabular-nums">{formatYen(c.amount)}</div>
                    <div className="text-xs text-slate-500">{c.amountPeriod ? PERIOD[c.amountPeriod] : ""}</div>
                  </div>
                )}
              </div>
              <dl className="mt-2 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
                <div>
                  <dt className="inline text-slate-500">期間 </dt>
                  <dd className="inline">
                    {ymd(c.startDate)}〜{ymd(c.endDate)}
                  </dd>
                </div>
                <div>
                  <dt className="inline text-slate-500">自動更新 </dt>
                  <dd className="inline">{c.autoRenew ? `あり(${c.renewalMonths ?? 12}か月ごと・次に解約できる満了 ${ymd(c.nextEnd)})` : "なし"}</dd>
                </div>
                <div>
                  <dt className="inline text-slate-500">解約の申し出 </dt>
                  <dd className="inline">{c.noticeDays !== null ? `満了の${c.noticeDays}日前(${ymd(c.deadline)})まで` : "-"}</dd>
                </div>
                {c.paymentTerms && (
                  <div className="sm:col-span-3">
                    <dt className="inline text-slate-500">支払条件 </dt>
                    <dd className="inline">{c.paymentTerms}</dd>
                  </div>
                )}
              </dl>
              {c.summary && <p className="mt-2 text-sm text-slate-700">{c.summary}</p>}
              {c.keyPoints.length > 0 && (
                <ul className="mt-2 space-y-0.5 text-sm text-amber-900">
                  {c.keyPoints.map((k, i) => (
                    <li key={i} className="pl-4 -indent-4">
                      ・{k}
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
                {c.file && (
                  <a href={c.file.href} target="_blank" className="text-indigo-700 hover:underline">
                    契約書を見る
                  </a>
                )}
                <button onClick={() => setEditing(editing === c.id ? null : c.id)} className="text-indigo-700 hover:underline">
                  内容を直す
                </button>
                <button onClick={() => patch(c.id, { status: c.status === "ACTIVE" ? "ENDED" : "ACTIVE" })} className="text-slate-600 hover:underline">
                  {c.status === "ACTIVE" ? "終了にする" : "有効に戻す"}
                </button>
                <button onClick={() => patch(c.id, {}, "DELETE")} className="text-rose-600 hover:underline">
                  台帳から外す
                </button>
                <span className="text-xs text-slate-400">{c.mode === "claude" ? "AIが読み取りました" : c.mode === "template" ? "読み取っていません" : ""}</span>
              </div>
              {editing === c.id && <Editor c={c} kinds={kinds} onDone={() => setEditing(null)} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useState, type ChangeEvent } from "react";
import { formatYen } from "@/lib/format";

type Account = { id: string; code: string; name: string; category: "ASSET" | "LIABILITY" | "EQUITY" };
type Data = { accounts: Account[]; amounts: Record<string, number>; startDate: string; savedAt: string | null; entryId: string | null };

const SECTIONS: { category: Account["category"]; label: string }[] = [
  { category: "ASSET", label: "資産" },
  { category: "LIABILITY", label: "負債" },
  { category: "EQUITY", label: "純資産" },
];
const toNumber = (v: string) => {
  const n = Number(v.normalize("NFKC").replace(/[,¥円\s]/g, ""));
  return Number.isFinite(n) ? Math.round(n) : 0;
};
const slash = (d: string) => d.replaceAll("-", "/");
function dayBefore(d: string) {
  const t = new Date(Date.parse(`${d}T00:00:00Z`) - 86_400_000);
  return Number.isNaN(t.getTime()) ? "" : t.toISOString().slice(0, 10);
}

export function OpeningBalancesView() {
  const [data, setData] = useState<Data | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [startDate, setStartDate] = useState("");
  const [toRetained, setToRetained] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [skipped, setSkipped] = useState<{ unmatched: { name: string; amount: number }[]; profitLoss: { name: string; amount: number }[] } | null>(null);

  async function load() {
    const res = await fetch("/api/opening-balances");
    if (!res.ok) return;
    const d: Data = await res.json();
    setData(d);
    setStartDate(d.startDate);
    setValues(Object.fromEntries(Object.entries(d.amounts).map(([k, v]) => [k, String(v)])));
  }

  useEffect(() => {
    // Fetch-on-mount: setState always lands after the fetch's await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  async function importCsv(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    setMessage(null);
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/opening-balances/import", { method: "POST", body: form });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setMessage({ ok: false, text: json.error || "読み取れませんでした" });
    setValues(Object.fromEntries(Object.entries(json.amounts as Record<string, number>).map(([k, v]) => [k, String(v)])));
    setSkipped({ unmatched: json.unmatched, profitLoss: json.profitLoss });
    setMessage({ ok: true, text: `${Object.keys(json.amounts).length}科目の残高を読み取りました。内容を確かめて「登録する」を押してください(まだ保存していません)。` });
  }

  async function save() {
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/opening-balances", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ startDate, amounts: values, balanceToRetained: toRetained }) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setMessage({ ok: false, text: json.error || "登録できませんでした" });
    setMessage({ ok: true, text: `開始残高を登録しました(${slash(dayBefore(startDate))}の「前期繰越」の仕訳)。貸借対照表・総勘定元帳に反映されています。` });
    setSkipped(null);
    await load();
  }

  async function clear() {
    if (!confirm("登録した開始残高を取り消しますか?(前期繰越の仕訳を取消にします)")) return;
    setBusy(true);
    const res = await fetch("/api/opening-balances", { method: "DELETE" });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    setMessage(res.ok ? { ok: true, text: "開始残高を取り消しました。" } : { ok: false, text: json.error || "取り消せませんでした" });
    await load();
  }

  if (!data) return null;
  const sum = (category: Account["category"]) => data.accounts.filter((a) => a.category === category).reduce((s, a) => s + (category === "LIABILITY" && a.code === "1519" ? 0 : toNumber(values[a.code] ?? "")), 0);
  // 減価償却累計額(1519)は資産のマイナス
  const depreciation = toNumber(values["1519"] ?? "");
  const assets = sum("ASSET") - depreciation;
  const liabilities = sum("LIABILITY");
  const equity = sum("EQUITY");
  const diff = assets - liabilities - equity;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">開始残高(ほかの会計ソフトからの乗り換え)</h1>
        <p className="mt-1 text-sm text-slate-600">
          このシステムを使い始める日の前日時点の、現金・預金・売掛金・借入金などの残高を入れます。前の会計ソフトの「残高試算表」や「貸借対照表」の期末残高を写すか、CSVを読み込んでください。使い始める日の前日の日付で「前期繰越」の仕訳を1件作ります(入れ直すと作り直します)。
        </p>
      </div>

      {message && <div className={`rounded-md px-4 py-2 text-sm ${message.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"}`}>{message.text}</div>}

      <section className="flex flex-wrap items-end gap-4 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
        <label className="block">
          <span className="text-slate-600">このシステムを使い始める日</span>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="mt-1 block rounded-md border px-3 py-1.5" />
          <span className="mt-1 block text-xs text-slate-500">{startDate && `${slash(dayBefore(startDate))}時点の残高を入れてください`}</span>
        </label>
        <label className="block">
          <span className="text-slate-600">CSVから読み込む(弥生・freee・マネーフォワードなどの残高試算表・貸借対照表)</span>
          <input type="file" accept=".csv,text/csv" onChange={importCsv} disabled={busy} className="mt-1 block max-w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5" />
        </label>
        {data.savedAt && <span className="text-xs text-emerald-700">✓ 登録済み(使い始める日 {slash(data.startDate)})</span>}
      </section>

      {skipped && (skipped.unmatched.length > 0 || skipped.profitLoss.length > 0) && (
        <div className="space-y-1 rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {skipped.unmatched.length > 0 && (
            <p>
              科目が見つからず読み込まなかった行: {skipped.unmatched.map((u) => `${u.name} ${formatYen(u.amount)}`).join("・")}
              <Link href="/accounts" className="ml-1 underline">
                勘定科目を追加
              </Link>
              してから読み込み直すか、近い科目に手で入れてください。
            </p>
          )}
          {skipped.profitLoss.length > 0 && <p>売上・費用の科目は開始残高には入れません({skipped.profitLoss.map((u) => u.name).join("・")})。期の途中から使い始めるときは、その期の売上・費用を仕訳で入れてください。</p>}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {SECTIONS.map((sec) => (
          <section key={sec.category} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <h2 className="border-b bg-slate-50 px-4 py-2 text-sm font-semibold">{sec.label}</h2>
            <div className="divide-y">
              {data.accounts
                .filter((a) => a.category === sec.category || (sec.category === "ASSET" && a.code === "1519"))
                .filter((a) => !(sec.category === "LIABILITY" && a.code === "1519"))
                .map((a) => (
                  <label key={a.code} className="flex items-center justify-between gap-2 px-4 py-1.5 text-sm">
                    <span className="min-w-0 truncate">
                      <span className="text-xs text-slate-400">{a.code}</span> {a.name}
                      {a.code === "1519" && <span className="text-xs text-slate-500">(マイナスの資産)</span>}
                    </span>
                    <input
                      value={values[a.code] ?? ""}
                      onChange={(e) => setValues((v) => ({ ...v, [a.code]: e.target.value }))}
                      inputMode="numeric"
                      placeholder="0"
                      className="w-32 shrink-0 rounded-md border px-2 py-1 text-right tabular-nums"
                    />
                  </label>
                ))}
            </div>
          </section>
        ))}
      </div>

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <p>
            資産の合計
            <span className="block text-lg font-semibold tabular-nums">{formatYen(assets)}</span>
          </p>
          <p>
            負債の合計
            <span className="block text-lg font-semibold tabular-nums">{formatYen(liabilities)}</span>
          </p>
          <p>
            純資産の合計
            <span className="block text-lg font-semibold tabular-nums">{formatYen(equity)}</span>
          </p>
          <p>
            差額
            <span className={`block text-lg font-semibold tabular-nums ${diff === 0 ? "text-emerald-700" : "text-amber-700"}`}>{diff === 0 ? "ぴったり" : formatYen(diff)}</span>
          </p>
        </div>
        {diff !== 0 && (
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={toRetained} onChange={(e) => setToRetained(e.target.checked)} className="mt-1" />
            <span>
              差額を「繰越利益剰余金」に足す(前期までの利益の合計として扱います)
              <span className="block text-xs text-slate-500">外すと、資産 = 負債 + 純資産 でないと登録できません。</span>
            </span>
          </label>
        )}
        <div className="flex flex-wrap gap-2">
          <button onClick={save} disabled={busy} className="rounded-md bg-indigo-600 px-5 py-2 font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
            {data.savedAt ? "入れ直す" : "登録する"}
          </button>
          {data.savedAt && (
            <button onClick={clear} disabled={busy} className="rounded-md border border-slate-300 px-4 py-2 text-slate-600 hover:bg-slate-50 disabled:opacity-50">
              取り消す
            </button>
          )}
        </div>
        <p className="text-xs text-slate-500">
          売掛金・買掛金を取引先ごとに管理したいときは、まだ入金・支払いされていない請求書を「請求書」に登録してください(その分は売掛金・買掛金に入るので、ここでは差し引いて入れます)。固定資産は「固定資産」に取得価額と償却済みの額を登録すると、来月からの減価償却が計算されます。
        </p>
      </section>
    </div>
  );
}

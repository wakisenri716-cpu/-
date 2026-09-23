"use client";

import { useEffect, useState, type FormEvent } from "react";
import { formatDate, formatYen } from "@/lib/format";

type Account = { id: string; code: string; name: string; category: string };

type BankRow = {
  id: string;
  date: string;
  description: string;
  withdrawal: number;
  deposit: number;
  status: "PENDING" | "POSTED" | "MATCHED" | "IGNORED";
  suggestedAccountCode: string | null;
  confidence: number | null;
  suggestionSource: string | null;
  suggestionReason: string | null;
  matchedInvoice?: { invoiceNumber: string | null } | null;
};

type BankData = { pending: BankRow[]; processed: BankRow[]; accounts: Account[] };

type ImportSummary = { received: number; imported: number; matched: number; autoPosted: number; pending: number };

const SOURCE_LABELS: Record<string, string> = {
  INVOICE: "請求書消込",
  HISTORY: "過去の記帳から学習",
  RULE: "キーワード",
  AI: "AI",
  MANUAL: "手動で確定",
};

const CATEGORY_LABELS: [string, string][] = [
  ["ASSET", "資産"],
  ["LIABILITY", "負債"],
  ["EQUITY", "純資産"],
  ["REVENUE", "収益"],
  ["EXPENSE", "費用"],
];

function confidenceClass(confidence: number | null) {
  if (confidence == null) return "bg-slate-100 text-slate-600";
  if (confidence >= 0.9) return "bg-emerald-100 text-emerald-800";
  if (confidence >= 0.6) return "bg-amber-100 text-amber-800";
  return "bg-rose-100 text-rose-700";
}

export default function BankPage() {
  const [data, setData] = useState<BankData | null>(null);
  const [tab, setTab] = useState<"pending" | "processed">("pending");
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/bank");
    setData(await res.json());
  }

  useEffect(() => {
    // Fetch-on-mount: the resulting setState always lands after the fetch's
    // await, so the extra render this rule warns about never happens here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  const accounts = data?.accounts ?? [];
  const accountByCode = new Map(accounts.map((a) => [a.code, a]));

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setUploading(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/bank/import", { method: "POST", body: new FormData(form) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "取込に失敗しました");
      const s = body as ImportSummary;
      const parts = [`${s.imported}件を取込`];
      if (s.received > s.imported) parts.push(`${s.received - s.imported}件は取込済みのためスキップ`);
      parts.push(`請求書と消込 ${s.matched}件`, `自動で仕訳 ${s.autoPosted}件`, `確認待ち ${s.pending}件`);
      setMessage(parts.join(" / "));
      setTab(s.pending > 0 ? "pending" : "processed");
      form.reset();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
    } finally {
      setUploading(false);
    }
  }

  async function act(row: BankRow, action: "confirm" | "ignore" | "reopen") {
    const accountId = choices[row.id] ?? accountByCode.get(row.suggestedAccountCode ?? "")?.id ?? "";
    if (action === "confirm" && !accountId) {
      setError("勘定科目を選択してください");
      return;
    }
    setBusyId(row.id);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/bank/${row.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, accountId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "処理に失敗しました");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
    } finally {
      setBusyId(null);
    }
  }

  function resultLabel(row: BankRow) {
    if (row.status === "MATCHED") return `請求書 ${row.matchedInvoice?.invoiceNumber ?? ""} を消込`;
    if (row.status === "IGNORED") return "対象外";
    const account = accountByCode.get(row.suggestedAccountCode ?? "");
    return account ? `${account.code} ${account.name}` : "-";
  }

  const pending = data?.pending ?? [];
  const processed = data?.processed ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">銀行明細</h1>
        <p className="mt-1 text-sm text-slate-600">
          ネットバンキングからダウンロードした入出金明細のCSVを取り込むと、請求書と金額が一致するものは自動で消込み、
          それ以外は過去の記帳・キーワード・AIで勘定科目を判定して仕訳します。自信が低いものだけ「確認待ち」に残ります。
        </p>
      </div>

      {error && <div className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</div>}
      {message && <div className="rounded-md bg-emerald-50 px-4 py-2 text-sm text-emerald-800">{message}</div>}

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="font-semibold">明細CSVを取り込む</h2>
        <p className="text-xs text-slate-500">
          「日付」「摘要(内容)」「出金(お引出し)」「入金(お預入れ)」「残高」の列があるCSVに対応しています(Shift_JIS/UTF-8どちらも可)。
          同じ明細を何度取り込んでも二重にはなりません。
          {/* ページ遷移ではなくCSVファイルのダウンロードなので <Link> ではなく <a> を使う */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/api/bank/sample" className="ml-1 text-indigo-700 hover:underline">
            サンプルCSV
          </a>
        </p>
        <form onSubmit={handleUpload} className="flex flex-wrap items-end gap-3">
          <input
            type="file"
            name="file"
            accept=".csv,text/csv"
            required
            className="max-w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
          />
          <button
            type="submit"
            disabled={uploading}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
          >
            {uploading ? "AIが判定中..." : "取り込んで自動仕訳"}
          </button>
        </form>
      </section>

      <div className="flex gap-2 border-b">
        {(
          [
            ["pending", `確認待ち (${pending.length})`],
            ["processed", "処理済み"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-3 py-2 text-sm font-medium ${
              tab === key ? "border-b-2 border-indigo-600 text-indigo-700" : "text-slate-500"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs whitespace-nowrap uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2">日付</th>
                <th className="px-4 py-2">摘要</th>
                <th className="px-4 py-2 text-right">出金</th>
                <th className="px-4 py-2 text-right">入金</th>
                <th className="px-4 py-2">{tab === "pending" ? "AIの提案" : "結果"}</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {(tab === "pending" ? pending : processed).map((row) => (
                <tr key={row.id} className="align-top">
                  <td className="px-4 py-2 whitespace-nowrap">{formatDate(row.date)}</td>
                  <td className="min-w-[10rem] px-4 py-2">{row.description}</td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">{row.withdrawal ? formatYen(row.withdrawal) : ""}</td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">{row.deposit ? formatYen(row.deposit) : ""}</td>
                  <td className="min-w-[14rem] px-4 py-2">
                    {tab === "pending" ? (
                      <select
                        value={choices[row.id] ?? accountByCode.get(row.suggestedAccountCode ?? "")?.id ?? ""}
                        onChange={(e) => setChoices((prev) => ({ ...prev, [row.id]: e.target.value }))}
                        className="w-full rounded-md border px-2 py-1 text-sm"
                      >
                        <option value="">選択してください</option>
                        {CATEGORY_LABELS.map(([category, label]) => (
                          <optgroup key={category} label={label}>
                            {accounts
                              .filter((a) => a.category === category)
                              .map((a) => (
                                <option key={a.id} value={a.id}>
                                  {a.code} {a.name}
                                </option>
                              ))}
                          </optgroup>
                        ))}
                      </select>
                    ) : (
                      <div className={row.status === "IGNORED" ? "text-slate-400" : ""}>{resultLabel(row)}</div>
                    )}
                    {row.suggestionSource && (
                      <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-slate-500">
                        <span className={`rounded-full px-2 py-0.5 font-medium whitespace-nowrap ${confidenceClass(row.confidence)}`}>
                          {SOURCE_LABELS[row.suggestionSource] ?? row.suggestionSource}
                          {row.confidence != null && ` ${Math.round(row.confidence * 100)}%`}
                        </span>
                        <span>{row.suggestionReason}</span>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    {tab === "pending" ? (
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => act(row, "confirm")}
                          disabled={busyId === row.id}
                          className="rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                        >
                          確定
                        </button>
                        <button
                          onClick={() => act(row, "ignore")}
                          disabled={busyId === row.id}
                          className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                        >
                          対象外
                        </button>
                      </div>
                    ) : (
                      row.status !== "MATCHED" && (
                        <button
                          onClick={() => act(row, "reopen")}
                          disabled={busyId === row.id}
                          className="text-xs text-slate-500 hover:text-indigo-700 hover:underline disabled:opacity-50"
                        >
                          やり直す
                        </button>
                      )
                    )}
                  </td>
                </tr>
              ))}
              {data && (tab === "pending" ? pending : processed).length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                    {tab === "pending" ? "確認待ちの明細はありません。" : "まだ処理した明細がありません。"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

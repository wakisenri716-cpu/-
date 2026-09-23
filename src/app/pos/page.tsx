"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { formatYen } from "@/lib/format";

type DaySummary = {
  provider: "SMAREGI" | "AIRREGI";
  businessDate: string;
  journalEntryId: string | null;
  count: number;
  totalAmount: number;
  taxAmount: number;
  cashAmount: number;
  cashlessAmount: number;
};

type PosStatus = {
  smaregi: { connected: boolean; sandbox: boolean };
  days: DaySummary[];
};

type ImportResult = {
  received: number;
  imported: number;
  duplicates: number;
  entriesCreated: number;
  skipped?: number;
  demo?: boolean;
};

const PROVIDER_LABELS: Record<DaySummary["provider"], string> = { SMAREGI: "スマレジ", AIRREGI: "Airレジ" };

function isoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return isoDate(d);
}

function describe(result: ImportResult): string {
  const parts = [`${result.imported}件を新規取込`];
  if (result.duplicates > 0) parts.push(`${result.duplicates}件は取込済みのためスキップ`);
  if (result.skipped) parts.push(`取消・入出金など${result.skipped}件は売上対象外`);
  parts.push(`仕訳${result.entriesCreated}件を自動記帳`);
  return parts.join(" / ");
}

export default function PosPage() {
  const [status, setStatus] = useState<PosStatus | null>(null);
  const [from, setFrom] = useState(daysAgo(6));
  const [to, setTo] = useState(daysAgo(0));
  const [syncing, setSyncing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/pos");
    setStatus(await res.json());
  }

  useEffect(() => {
    // Fetch-on-mount: the resulting setState always lands after the fetch's
    // await, so the extra render this rule warns about never happens here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  async function handleSync(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSyncing(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/pos/smaregi/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "同期に失敗しました");
      setMessage(`スマレジ${body.demo ? "(デモデータ)" : ""}: ${describe(body)}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
    } finally {
      setSyncing(false);
    }
  }

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setUploading(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/pos/airregi/import", { method: "POST", body: new FormData(form) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "取込に失敗しました");
      setMessage(`Airレジ: ${describe(body)}`);
      form.reset();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
    } finally {
      setUploading(false);
    }
  }

  const smaregi = status?.smaregi;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">POSレジ連携</h1>
        <p className="mt-1 text-sm text-slate-600">
          スマレジ・Airレジの売上を取り込み、営業日ごとに「現金・クレジット売掛金 / 売上高・仮受消費税」の仕訳を自動で記帳します。
          同じ会計を2回取り込んでも重複しません。
        </p>
      </div>

      {error && <div className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</div>}
      {message && <div className="rounded-md bg-emerald-50 px-4 py-2 text-sm text-emerald-800">{message}</div>}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold">スマレジ</h2>
            {smaregi && (
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${
                  smaregi.connected ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
                }`}
              >
                {smaregi.connected ? (smaregi.sandbox ? "API接続済み(サンドボックス)" : "API接続済み") : "未接続(デモモード)"}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500">
            {smaregi?.connected
              ? "スマレジ・プラットフォームAPIから期間内の取引を取得します(最大31日間)。"
              : "環境変数 SMAREGI_CONTRACT_ID / SMAREGI_CLIENT_ID / SMAREGI_CLIENT_SECRET を設定するとAPIに接続します。未設定の間は動作確認用のデモ取引で同期します。"}
          </p>
          <form onSubmit={handleSync} className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs text-slate-500">開始日</label>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                required
                className="rounded border px-2 py-1 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500">終了日</label>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                required
                className="rounded border px-2 py-1 text-sm"
              />
            </div>
            <button
              type="submit"
              disabled={syncing}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
            >
              {syncing ? "同期中..." : "売上を同期"}
            </button>
          </form>
        </section>

        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold">Airレジ</h2>
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium whitespace-nowrap text-slate-700">
              CSV取込
            </span>
          </div>
          <p className="text-xs text-slate-500">
            Airレジ バックオフィスの「日別売上」→「CSVデータをダウンロードする」→「会計明細」で出力したCSVをそのままアップロードしてください
            (Shift_JIS/UTF-8どちらも可)。
            <a href="/api/pos/airregi/sample" className="ml-1 text-indigo-700 hover:underline">
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
              {uploading ? "取込中..." : "CSVを取り込む"}
            </button>
          </form>
        </section>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b px-4 py-3 text-sm font-semibold">取込済みの日次売上</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs whitespace-nowrap uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2">営業日</th>
                <th className="px-4 py-2">レジ</th>
                <th className="px-4 py-2 text-right">会計数</th>
                <th className="px-4 py-2 text-right">売上(税込)</th>
                <th className="px-4 py-2 text-right">うち消費税</th>
                <th className="px-4 py-2 text-right">現金</th>
                <th className="px-4 py-2 text-right">キャッシュレス</th>
                <th className="px-4 py-2">仕訳</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {status?.days.map((day) => (
                <tr key={`${day.provider}-${day.businessDate}-${day.journalEntryId}`}>
                  <td className="px-4 py-2 whitespace-nowrap">{day.businessDate}</td>
                  <td className="px-4 py-2 whitespace-nowrap">{PROVIDER_LABELS[day.provider]}</td>
                  <td className="px-4 py-2 text-right">{day.count}</td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">{formatYen(day.totalAmount)}</td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">{formatYen(day.taxAmount)}</td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">{formatYen(day.cashAmount)}</td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">{formatYen(day.cashlessAmount)}</td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    {day.journalEntryId ? (
                      <Link href="/ledger" className="text-xs text-indigo-700 hover:underline">
                        記帳済み
                      </Link>
                    ) : (
                      <span className="text-xs text-slate-400">未記帳</span>
                    )}
                  </td>
                </tr>
              ))}
              {status && status.days.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-slate-400">
                    まだ取り込んだ売上がありません。
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

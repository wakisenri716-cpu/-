"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { formatYen } from "@/lib/format";

type Entry = {
  key: string;
  rowNumbers: number[];
  date: string;
  description: string;
  lines: { accountLabel: string; debit: number; credit: number }[];
  total: number;
  duplicate: boolean;
};

export default function JournalImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<{ entries: Entry[]; errors: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function send(previewOnly: boolean) {
    if (!file) return;
    setBusy(true);
    setMessage(null);
    const form = new FormData();
    form.set("file", file);
    const res = await fetch(`/api/journal/import${previewOnly ? "?preview=1" : ""}`, { method: "POST", body: form });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setPreview(null);
      return setMessage({ ok: false, text: body.error || "読み込めませんでした" });
    }
    if (previewOnly) return setPreview(body);
    setPreview(null);
    setFile(null);
    setMessage({ ok: true, text: `${body.imported}件の仕訳を取り込みました${body.skipped ? `(取込済みと同じ${body.skipped}件は飛ばしました)` : ""}` });
  }

  function onPreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    send(true);
  }

  const newCount = preview?.entries.filter((e) => !e.duplicate).length ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/journal" className="text-sm text-indigo-700 hover:underline">
          ← 仕訳帳
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">仕訳のCSV取込</h1>
        <p className="mt-1 text-sm text-slate-600">
          他の会計ソフトやExcelで作った仕訳をまとめて取り込めます。1行に借方と貸方を1つずつ書き、同じ伝票番号の行は1つの仕訳(複合仕訳)になります。
          勘定科目は科目コード(例: 5060)でも科目名(例: 地代家賃)でも指定できます。
        </p>
        <a href="/api/journal/import/sample" className="mt-2 inline-block text-sm text-indigo-700 hover:underline">
          サンプルCSVをダウンロード
        </a>
      </div>

      {message && (
        <div className={`rounded-md px-4 py-2 text-sm ${message.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"}`}>{message.text}</div>
      )}

      <form onSubmit={onPreview} className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <label className="text-xs text-slate-500">
          CSVファイル(UTF-8 / Shift_JIS)
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setPreview(null);
            }}
            className="mt-1 block text-sm text-slate-900"
          />
        </label>
        <button type="submit" disabled={!file || busy} className="rounded-md border border-indigo-600 px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50">
          {busy ? "読み込み中..." : "内容を確認"}
        </button>
      </form>

      {preview && (
        <section className="space-y-3">
          {preview.errors.length > 0 ? (
            <div className="rounded-md bg-rose-50 px-4 py-3 text-sm text-rose-800">
              <p className="font-medium">取り込めない行があります。CSVを直してから、もう一度選んでください。</p>
              <ul className="mt-1 list-disc pl-5">
                {preview.errors.slice(0, 20).map((e) => (
                  <li key={e}>{e}</li>
                ))}
                {preview.errors.length > 20 && <li>ほか{preview.errors.length - 20}件</li>}
              </ul>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-sm text-emerald-900">
                {newCount}件の仕訳を取り込みます
                {preview.entries.length - newCount > 0 && `(取込済みと同じ${preview.entries.length - newCount}件は飛ばします)`}。
              </p>
              <button
                onClick={() => send(false)}
                disabled={busy || newCount === 0}
                className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                取り込む
              </button>
            </div>
          )}

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs whitespace-nowrap text-slate-500">
                  <tr>
                    <th className="px-4 py-2">行</th>
                    <th className="px-4 py-2">日付</th>
                    <th className="px-4 py-2">摘要</th>
                    <th className="px-4 py-2">借方</th>
                    <th className="px-4 py-2">貸方</th>
                    <th className="px-4 py-2 text-right">金額</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {preview.entries.map((e) => (
                    <tr key={e.key} className={e.duplicate ? "text-slate-400" : ""}>
                      <td className="px-4 py-2 whitespace-nowrap">{e.rowNumbers.length > 1 ? `${e.rowNumbers[0]}〜${e.rowNumbers.at(-1)}` : e.rowNumbers[0]}</td>
                      <td className="px-4 py-2 whitespace-nowrap">{e.date.replaceAll("-", "/")}</td>
                      <td className="min-w-[10rem] px-4 py-2">
                        {e.description}
                        {e.duplicate && <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs">取込済み</span>}
                      </td>
                      <td className="px-4 py-2 text-xs whitespace-nowrap">
                        {e.lines.filter((l) => l.debit).map((l, i) => (
                          <div key={i}>
                            {l.accountLabel} {formatYen(l.debit)}
                          </div>
                        ))}
                      </td>
                      <td className="px-4 py-2 text-xs whitespace-nowrap">
                        {e.lines.filter((l) => l.credit).map((l, i) => (
                          <div key={i}>
                            {l.accountLabel} {formatYen(l.credit)}
                          </div>
                        ))}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap">{formatYen(e.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
      <p className="text-xs text-slate-500">
        取り込んだ仕訳は仕訳帳に「CSV取込」と表示され、1件ずつ取り消せます。エラーが1行でもあるファイルは、何も取り込みません。
      </p>
    </div>
  );
}

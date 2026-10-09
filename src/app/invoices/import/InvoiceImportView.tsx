"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { formatYen } from "@/lib/format";

type Preview = {
  invoices: { key: string; customerName: string; email: string | null; issueDate: string; dueDate: string; lines: { description: string }[]; rows: number[]; total: number; newCustomer: boolean }[];
  errors: string[];
  total: number;
};
type Unsent = { id: string; invoiceNumber: string | null; customerName: string; email: string | null; issueDate: string | null; dueDate: string | null; total: number; check: { errors: number; warns: number; first: string | null } | null };
type SendResult = { sent: number; failed: number; results: { id: string; ok: boolean; message: string }[] };

const slash = (d: string | null) => (d ? d.replaceAll("-", "/") : "-");

export function InvoiceImportView() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [unsent, setUnsent] = useState<Unsent[]>([]);
  const [companyIssues, setCompanyIssues] = useState<{ level: string; message: string }[]>([]);
  const [mode, setMode] = useState("smtp");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sendResult, setSendResult] = useState<SendResult | null>(null);

  const loadUnsent = useCallback(async () => {
    const res = await fetch("/api/invoices/bulk-send");
    if (!res.ok) return;
    const json = await res.json();
    setUnsent(json.invoices);
    setCompanyIssues(json.companyIssues ?? []);
    setMode(json.mode);
    // 送る前チェックで「直してください」がある請求書は、はじめは選ばない
    setSelected(new Set(json.invoices.filter((i: Unsent) => i.email && !i.check?.errors).map((i: Unsent) => i.id)));
  }, []);

  useEffect(() => {
    // Fetch-on-mount: setState always lands after the fetch's await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadUnsent();
  }, [loadUnsent]);

  async function upload(importMode: "preview" | "import") {
    if (!file) return;
    setBusy(true);
    setMessage(null);
    const form = new FormData();
    form.append("file", file);
    form.append("mode", importMode);
    const res = await fetch("/api/invoices/import", { method: "POST", body: form });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setMessage({ ok: false, text: json.error || "読み込めませんでした" });
    if (importMode === "preview") return setPreview(json);
    setMessage({ ok: true, text: `請求書を${json.created.length}枚作りました(合計 ${formatYen(json.total)})。下の「まとめてメールで送る」から送れます。` });
    setPreview(null);
    setFile(null);
    await loadUnsent();
  }

  async function send() {
    const withErrors = unsent.filter((u) => selected.has(u.id) && u.check?.errors).length;
    if (!confirm(`${selected.size}件の請求書をメールで送りますか?${withErrors ? `\n(うち${withErrors}件は送る前のチェックで「直してください」があります)` : ""}`)) return;
    setBusy(true);
    setSendResult(null);
    const res = await fetch("/api/invoices/bulk-send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: [...selected] }) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setMessage({ ok: false, text: json.error || "送れませんでした" });
    setSendResult(json);
    await loadUnsent();
  }

  const unsentById = new Map(unsent.map((u) => [u.id, u]));

  return (
    <div className="space-y-6">
      <div>
        <Link href="/invoices" className="text-sm text-indigo-700 hover:underline">
          ← 請求書
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">請求書の一括作成・まとめて送信</h1>
        <p className="mt-1 text-sm text-slate-600">
          表計算ソフトで作ったCSV(1行が明細1行)から、請求書をまとめて作ります。「まとめ」の列が同じ行(なければ 請求先・請求日・支払期限 が同じ行)が1枚の請求書になります。作った請求書は、いつもの文面(請求書を見るリンクつき)でまとめてメールで送れます。
        </p>
      </div>

      {message && <div className={`rounded-md px-4 py-2 text-sm ${message.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"}`}>{message.text}</div>}

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">1. CSVを読み込む</h2>
          <a href="/api/invoices/import" className="text-indigo-700 hover:underline">
            サンプルCSVをダウンロード
          </a>
        </div>
        <p className="text-xs text-slate-500">列: まとめ・請求先・メールアドレス(任意)・請求日・支払期限(空なら顧客の支払条件、なければ翌月末)・品目・数量・単位・単価(税抜)・税率(10 か 8)・備考。Shift_JIS・UTF-8 どちらでも読めます。</p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setPreview(null);
            }}
            className="max-w-full text-sm"
          />
          <button disabled={busy || !file} onClick={() => upload("preview")} className="rounded-md border border-indigo-600 px-4 py-2 font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50">
            内容を確認する
          </button>
        </div>

        {preview && (
          <div className="space-y-3">
            {preview.errors.length > 0 && (
              <div className="rounded-md bg-rose-50 px-3 py-2 text-rose-800">
                <p className="font-medium">直してから読み込み直してください({preview.errors.length}件)</p>
                <ul className="mt-1 list-disc pl-5 text-xs">
                  {preview.errors.slice(0, 20).map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </div>
            )}
            <ul className="divide-y rounded-lg border">
              {preview.invoices.map((inv) => (
                <li key={inv.key} className="flex items-start justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <p>
                      {inv.customerName}
                      {inv.newCustomer && <span className="ml-1 rounded bg-sky-100 px-1 text-xs text-sky-800">新しい顧客</span>}
                    </p>
                    <p className="text-xs text-slate-500">
                      {slash(inv.issueDate)}・期限 {slash(inv.dueDate)}
                      {inv.email && `・${inv.email}`}
                    </p>
                    <p className="text-xs text-slate-600">
                      {inv.lines
                        .slice(0, 3)
                        .map((l) => l.description)
                        .join("・")}
                      {inv.lines.length > 3 && ` ほか${inv.lines.length - 3}行`}
                      <span className="text-slate-400">(CSVの{inv.rows.join("・")}行目)</span>
                    </p>
                  </div>
                  <span className="whitespace-nowrap tabular-nums">{inv.total ? formatYen(inv.total) : "-"}</span>
                </li>
              ))}
            </ul>
            <button disabled={busy || preview.errors.length > 0} onClick={() => upload("import")} className="w-full rounded-md bg-vermilion-600 px-4 py-2 font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
              請求書を{preview.invoices.length}枚作る(合計 {formatYen(preview.total)})
            </button>
            <p className="text-xs text-slate-500">作ると、請求書ごとに売上の仕訳(売掛金 / 売上高・仮受消費税)が記帳されます。請求書番号は請求日の月ごとの連番です。</p>
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white text-sm shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
          <h2 className="font-semibold">2. まだ送っていない請求書をまとめてメールで送る</h2>
          {mode === "test" && <span className="text-xs text-amber-700">メールの送信設定がまだのため、送信はテスト(記録だけ)になります</span>}
        </div>
        {sendResult && (
          <div className="border-b px-4 py-2">
            <p className={sendResult.failed ? "text-amber-800" : "text-emerald-800"}>
              {sendResult.sent}件送りました{sendResult.failed ? `・${sendResult.failed}件は送れませんでした` : ""}。
            </p>
            {sendResult.results
              .filter((r) => !r.ok)
              .map((r) => (
                <p key={r.id} className="text-xs text-rose-700">
                  {unsentById.get(r.id)?.customerName ?? ""} {unsentById.get(r.id)?.invoiceNumber ?? ""}: {r.message}
                </p>
              ))}
          </div>
        )}
        {companyIssues.some((c) => c.level !== "info") && (
          <div className="border-b bg-amber-50 px-4 py-2 text-xs text-amber-900">
            {companyIssues.map((c) => (
              <p key={c.message}>
                ・{c.message}(
                <Link href="/company" className="underline">
                  会社情報
                </Link>
                )
              </p>
            ))}
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 text-left text-xs whitespace-nowrap text-slate-500">
              <tr>
                <th className="px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label="すべて選ぶ"
                    checked={unsent.some((u) => u.email) && unsent.filter((u) => u.email).every((u) => selected.has(u.id))}
                    onChange={(e) => setSelected(new Set(e.target.checked ? unsent.filter((u) => u.email).map((u) => u.id) : []))}
                  />
                </th>
                <th className="px-3 py-2">請求書</th>
                <th className="px-3 py-2">宛先</th>
                <th className="px-3 py-2 text-right">金額</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {unsent.map((u) => (
                <tr key={u.id}>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      disabled={!u.email}
                      checked={selected.has(u.id)}
                      aria-label={`${u.customerName}に送る`}
                      onChange={(e) =>
                        setSelected((s) => {
                          const n = new Set(s);
                          if (e.target.checked) n.add(u.id);
                          else n.delete(u.id);
                          return n;
                        })
                      }
                    />
                  </td>
                  <td className="px-3 py-2">
                    {u.customerName}
                    <span className="block text-xs text-slate-500">
                      {u.invoiceNumber} ・ {slash(u.issueDate)}
                    </span>
                    {u.check && (u.check.errors > 0 || u.check.warns > 0) && (
                      <Link href={`/invoices/${u.id}/print`} className={`mt-0.5 block text-xs hover:underline ${u.check.errors ? "text-rose-700" : "text-amber-800"}`}>
                        {u.check.errors ? `直してください ${u.check.errors}件` : `確かめてください ${u.check.warns}件`}: {u.check.first}
                      </Link>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {u.email ?? (
                      <Link href={`/invoices/${u.id}/print`} className="text-amber-700 hover:underline">
                        メールアドレスなし(請求書から1件ずつ送れます)
                      </Link>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">{formatYen(u.total)}</td>
                </tr>
              ))}
              {unsent.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-slate-400">
                    まだ送っていない請求書はありません。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t p-4">
          <button disabled={busy || selected.size === 0} onClick={send} className="w-full rounded-md bg-vermilion-600 px-4 py-2 font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
            選んだ{selected.size}件をメールで送る
          </button>
        </div>
      </section>
    </div>
  );
}

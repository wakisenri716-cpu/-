"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { formatDate, formatYen } from "@/lib/format";
import { CsvDownloadLink } from "@/components/CsvDownloadLink";

type Account = { id: string; code: string; name: string; category: string };

type Entry = {
  id: string;
  date: string;
  description: string;
  sourceType: string;
  status: string;
  department: { id: string; name: string } | null;
  lines: { id: string; accountId: string; debit: number; credit: number; memo: string | null; account: { code: string; name: string } }[];
};

type SavedTemplate = { id: string; name: string; description: string; lines: { accountId: string; debit: number; credit: number; memo: string }[] };

type LineDraft = { accountId: string; debit: string; credit: string; memo: string };

const SOURCE_LABELS: Record<string, string> = {
  EXPENSE_ITEM: "経費精算",
  INVOICE: "請求書",
  PAYMENT: "入金・支払",
  FIXED_ASSET: "固定資産",
  POS_SALE: "POSレジ",
  INVENTORY: "在庫",
  MANUAL: "手入力",
  BANK: "銀行明細",
  PAYROLL: "給料",
  REIMBURSEMENT: "立替経費の精算",
  RECURRING: "定期取引",
  IMPORT: "CSV取込",
};

const CATEGORY_LABELS: [string, string][] = [
  ["ASSET", "資産"],
  ["LIABILITY", "負債"],
  ["EQUITY", "純資産"],
  ["REVENUE", "収益"],
  ["EXPENSE", "費用"],
];

// 経理に慣れていなくても入力できるよう、よくある取引は借方・貸方の科目を先に埋める
const TEMPLATES: { label: string; description: string; debit: string; credit: string }[] = [
  { label: "資本金を入金", description: "資本金の払込", debit: "1020", credit: "3010" },
  { label: "お金を借りた", description: "借入金の入金", debit: "1020", credit: "2210" },
  { label: "借入金を返済", description: "借入金の返済", debit: "2210", credit: "1020" },
  { label: "給料を支払", description: "給料の支払", debit: "5110", credit: "1020" },
  { label: "家賃を支払", description: "家賃の支払", debit: "5060", credit: "1020" },
  { label: "現金を預金に入金", description: "現金の預け入れ", debit: "1020", credit: "1010" },
];

const emptyLine = (): LineDraft => ({ accountId: "", debit: "", credit: "", memo: "" });

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const inputClass = "w-full rounded-md border px-2 py-1.5 text-sm";

export default function JournalPage() {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [departmentId, setDepartmentId] = useState("");
  const [month, setMonth] = useState("");
  // 検索条件(入力中の値と、実際に検索に使う値を分ける)
  const [search, setSearch] = useState({ q: "", accountId: "", min: "", max: "", source: "" });
  const [applied, setApplied] = useState(search);
  const [date, setDate] = useState(today());
  const [description, setDescription] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([emptyLine(), emptyLine()]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedTemplate[]>([]);

  const query = new URLSearchParams(
    Object.entries({ month, ...applied }).filter(([, v]) => v !== "") as [string, string][],
  ).toString();
  const searching = Object.values(applied).some((v) => v !== "");

  const load = useCallback(async () => {
    const res = await fetch(`/api/journal${query ? `?${query}` : ""}`);
    const body = await res.json();
    setEntries(body.entries);
    setAccounts(body.accounts);
    setDepartments(body.departments ?? []);
  }, [query]);

  const loadTemplates = useCallback(async () => {
    const res = await fetch("/api/journal/templates");
    if (res.ok) setSaved(await res.json());
  }, []);

  useEffect(() => {
    // Fetch-on-mount: setState always lands after the fetch's await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadTemplates();
  }, [loadTemplates]);

  useEffect(() => {
    // Fetch-on-mount/month change: the resulting setState always lands after
    // the fetch's await, so the extra render this rule warns about never happens here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const totalDebit = lines.reduce((sum, l) => sum + (Number(l.debit) || 0), 0);
  const totalCredit = lines.reduce((sum, l) => sum + (Number(l.credit) || 0), 0);
  const balanced = totalDebit > 0 && totalDebit === totalCredit;

  function updateLine(index: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  function applyTemplate(template: (typeof TEMPLATES)[number]) {
    const byCode = (code: string) => accounts.find((a) => a.code === code)?.id ?? "";
    setDescription(template.description);
    setLines([
      { accountId: byCode(template.debit), debit: "", credit: "", memo: "" },
      { accountId: byCode(template.credit), debit: "", credit: "", memo: "" },
    ]);
    setError(null);
    setMessage("科目を入れました。金額を借方・貸方の両方に入力してください。");
  }

  // 保存したひな形・既存の仕訳の内容を入力欄に入れる(金額もそのまま入る)
  function fillForm(text: string, source: { accountId: string; debit: number; credit: number; memo: string | null }[], note: string) {
    const known = new Set(accounts.map((a) => a.id));
    const rows = source
      .filter((l) => known.has(l.accountId))
      .map((l) => ({ accountId: l.accountId, debit: l.debit ? String(l.debit) : "", credit: l.credit ? String(l.credit) : "", memo: l.memo ?? "" }));
    while (rows.length < 2) rows.push(emptyLine());
    setDescription(text);
    setLines(rows);
    setError(null);
    setMessage(note);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function applySaved(template: SavedTemplate) {
    fillForm(template.description, template.lines, `ひな形「${template.name}」を入れました。日付と金額を確認して登録してください。`);
  }

  function duplicate(entry: Entry) {
    setDepartmentId(entry.department && departments.some((d) => d.id === entry.department!.id) ? entry.department.id : "");
    fillForm(entry.description, entry.lines, `「${entry.description}」の内容をコピーしました。日付を確認して登録してください。`);
  }

  async function saveAsTemplate() {
    const name = window.prompt("ひな形の名前(例: 毎月の家賃)", description.slice(0, 30));
    if (!name?.trim()) return;
    setError(null);
    setMessage(null);
    const res = await fetch("/api/journal/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description, lines }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return setError(body.error || "ひな形を保存できませんでした");
    setMessage(`ひな形「${body.name}」を保存しました。次からは上のボタンで呼び出せます。`);
    loadTemplates();
  }

  async function deleteTemplate(template: SavedTemplate) {
    if (!window.confirm(`ひな形「${template.name}」を削除しますか?`)) return;
    const res = await fetch(`/api/journal/templates/${template.id}`, { method: "DELETE" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return setError(body.error || "削除できませんでした");
    loadTemplates();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/journal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, description, lines, departmentId: departmentId || null }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "登録に失敗しました");
      setDescription("");
      setLines([emptyLine(), emptyLine()]);
      setMessage("仕訳を登録しました。試算表・損益計算書・貸借対照表に反映されています。");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
    } finally {
      setSaving(false);
    }
  }

  async function changeDepartment(entry: Entry, id: string) {
    setError(null);
    setMessage(null);
    const res = await fetch(`/api/journal/${entry.id}/department`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ departmentId: id || null }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) setError(body.error || "部門を変更できませんでした");
    await load();
  }

  async function handleVoid(entry: Entry) {
    if (!confirm(`「${entry.description}」を取り消しますか?帳簿から除外されます。`)) return;
    setError(null);
    setMessage(null);
    const res = await fetch(`/api/journal/${entry.id}/void`, { method: "POST" });
    const body = await res.json();
    if (!res.ok) {
      setError(body.error || "取り消しに失敗しました");
      return;
    }
    setMessage("仕訳を取り消しました。");
    await load();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">仕訳帳</h1>
          <p className="mt-1 text-sm text-slate-600">
            すべての仕訳を日付順に確認できます。資本金・借入金・給料など、ほかの画面を通らない取引はここから直接入力します。
          </p>
        </div>
        <div className="flex gap-2 self-start">
          <Link
            href="/journal/import"
            className="rounded-md border border-indigo-600 px-3 py-1.5 text-xs font-medium whitespace-nowrap text-indigo-700 hover:bg-indigo-50"
          >
            CSVから取込
          </Link>
          <CsvDownloadLink href={`/api/journal/export${query ? `?${query}` : ""}`} print />
        </div>
      </div>

      {error && <div className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</div>}
      {message && <div className="rounded-md bg-emerald-50 px-4 py-2 text-sm text-emerald-800">{message}</div>}

      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm print:hidden">
        <h2 className="font-semibold">仕訳を入力</h2>
        <div className="flex flex-wrap gap-2">
          <span className="self-center text-xs text-slate-500">よく使う仕訳:</span>
          {TEMPLATES.map((t) => (
            <button
              key={t.label}
              type="button"
              onClick={() => applyTemplate(t)}
              className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700"
            >
              {t.label}
            </button>
          ))}
        </div>
        {saved.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <span className="self-center text-xs text-slate-500">保存したひな形:</span>
            {saved.map((t) => (
              <span key={t.id} className="inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 text-xs font-medium text-indigo-800">
                <button type="button" onClick={() => applySaved(t)} className="py-1 pr-1 pl-3 hover:underline">
                  {t.name}
                </button>
                <button type="button" onClick={() => deleteTemplate(t)} aria-label={`ひな形「${t.name}」を削除`} className="px-2 py-1 text-indigo-400 hover:text-rose-600">
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className={`grid gap-3 ${departments.length > 0 ? "sm:grid-cols-[10rem_1fr_12rem]" : "sm:grid-cols-[10rem_1fr]"}`}>
            <div>
              <label className="mb-1 block text-xs text-slate-500">日付</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required className={inputClass} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-500">摘要</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="例: 9月分の家賃"
                required
                className={inputClass}
              />
            </div>
            {departments.length > 0 && (
              <div>
                <label className="mb-1 block text-xs text-slate-500">部門(任意)</label>
                <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className={inputClass}>
                  <option value="">なし</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead className="text-left text-xs whitespace-nowrap text-slate-500">
                <tr>
                  <th className="pr-2 pb-1 font-medium">勘定科目</th>
                  <th className="w-36 pr-4 pb-1 text-right font-medium">借方金額</th>
                  <th className="w-36 pr-4 pb-1 text-right font-medium">貸方金額</th>
                  <th className="pr-2 pb-1 font-medium">メモ</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {lines.map((line, i) => (
                  <tr key={i} className="hover:bg-transparent">
                    <td className="py-1 pr-2">
                      <select
                        value={line.accountId}
                        onChange={(e) => updateLine(i, { accountId: e.target.value })}
                        className={inputClass}
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
                    </td>
                    <td className="py-1 pr-2">
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={line.debit}
                        onChange={(e) => updateLine(i, { debit: e.target.value, credit: e.target.value ? "" : line.credit })}
                        className={`${inputClass} text-right`}
                      />
                    </td>
                    <td className="py-1 pr-2">
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={line.credit}
                        onChange={(e) => updateLine(i, { credit: e.target.value, debit: e.target.value ? "" : line.debit })}
                        className={`${inputClass} text-right`}
                      />
                    </td>
                    <td className="py-1 pr-2">
                      <input
                        type="text"
                        value={line.memo}
                        onChange={(e) => updateLine(i, { memo: e.target.value })}
                        className={inputClass}
                      />
                    </td>
                    <td className="py-1 text-center">
                      {lines.length > 2 && (
                        <button
                          type="button"
                          onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}
                          aria-label="行を削除"
                          className="text-slate-400 hover:text-rose-600"
                        >
                          ×
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t text-sm font-medium">
                <tr>
                  <td className="pt-2">
                    <button
                      type="button"
                      onClick={() => setLines((prev) => [...prev, emptyLine()])}
                      className="text-xs font-medium text-indigo-700 hover:underline"
                    >
                      + 行を追加
                    </button>
                  </td>
                  <td className="pt-2 pr-4 text-right">{formatYen(totalDebit)}</td>
                  <td className="pt-2 pr-4 text-right">{formatYen(totalCredit)}</td>
                  <td className="pt-2" colSpan={2}>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs whitespace-nowrap ${
                        balanced
                          ? "bg-emerald-100 text-emerald-800"
                          : totalDebit === 0 && totalCredit === 0
                            ? "bg-slate-100 text-slate-600"
                            : "bg-rose-100 text-rose-800"
                      }`}
                    >
                      {balanced
                        ? "貸借一致"
                        : totalDebit === 0 && totalCredit === 0
                          ? "金額を入力"
                          : `差額 ${formatYen(Math.abs(totalDebit - totalCredit))}`}
                    </span>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={saveAsTemplate}
              disabled={lines.filter((l) => l.accountId).length < 2}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              ひな形として保存
            </button>
            <button
              type="submit"
              disabled={saving || !balanced}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? "登録中..." : "仕訳を登録"}
            </button>
          </div>
        </form>
      </section>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <span className="text-sm font-semibold">仕訳一覧</span>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <label htmlFor="month">表示する月</label>
            <input
              id="month"
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="rounded-md border px-2 py-1 text-sm text-slate-700"
            />
            {month && (
              <button type="button" onClick={() => setMonth("")} className="text-indigo-700 hover:underline">
                すべて
              </button>
            )}
          </div>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setApplied(search);
          }}
          className="grid gap-2 border-b bg-slate-50/60 px-4 py-3 sm:grid-cols-2 lg:grid-cols-[2fr_2fr_1.4fr_1.4fr_auto] print:hidden"
        >
          <input
            value={search.q}
            onChange={(e) => setSearch({ ...search, q: e.target.value })}
            placeholder="摘要・メモで検索"
            className="rounded-md border px-2 py-1.5 text-sm"
            aria-label="キーワード"
          />
          <select value={search.accountId} onChange={(e) => setSearch({ ...search, accountId: e.target.value })} className="rounded-md border px-2 py-1.5 text-sm" aria-label="勘定科目">
            <option value="">すべての勘定科目</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} {a.name}
              </option>
            ))}
          </select>
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1">
            <input type="number" min={0} value={search.min} onChange={(e) => setSearch({ ...search, min: e.target.value })} placeholder="金額 下限" className="w-full min-w-0 rounded-md border px-2 py-1.5 text-sm" aria-label="金額の下限" />
            <span className="text-xs text-slate-400">〜</span>
            <input type="number" min={0} value={search.max} onChange={(e) => setSearch({ ...search, max: e.target.value })} placeholder="上限" className="w-full min-w-0 rounded-md border px-2 py-1.5 text-sm" aria-label="金額の上限" />
          </div>
          <select value={search.source} onChange={(e) => setSearch({ ...search, source: e.target.value })} className="rounded-md border px-2 py-1.5 text-sm" aria-label="種類">
            <option value="">すべての種類</option>
            {Object.entries(SOURCE_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <button type="submit" className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium whitespace-nowrap text-white hover:bg-indigo-700">
              検索
            </button>
            {searching && (
              <button
                type="button"
                onClick={() => {
                  const empty = { q: "", accountId: "", min: "", max: "", source: "" };
                  setSearch(empty);
                  setApplied(empty);
                }}
                className="rounded-md border px-3 py-1.5 text-sm whitespace-nowrap text-slate-600 hover:bg-white"
              >
                クリア
              </button>
            )}
          </div>
          {searching && entries && <p className="text-xs text-slate-500 sm:col-span-2 lg:col-span-5">{entries.length}件見つかりました(金額は明細1行の金額で探します)</p>}
        </form>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs whitespace-nowrap uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2">日付</th>
                <th className="px-4 py-2">摘要</th>
                <th className="px-4 py-2">借方</th>
                <th className="px-4 py-2">貸方</th>
                <th className="px-4 py-2">区分</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {entries?.map((entry) => {
                const isVoid = entry.status === "VOID";
                const side = (key: "debit" | "credit") =>
                  entry.lines
                    .filter((l) => l[key] > 0)
                    .map((l) => (
                      <div key={l.id} className="flex justify-between gap-3 whitespace-nowrap">
                        <span>{l.account.name}</span>
                        <span className="tabular-nums">{formatYen(l[key])}</span>
                      </div>
                    ));
                return (
                  <tr key={entry.id} className={`align-top ${isVoid ? "text-slate-400 line-through" : ""}`}>
                    <td className="px-4 py-2 whitespace-nowrap">{formatDate(entry.date)}</td>
                    <td className="min-w-[10rem] px-4 py-2">
                      {entry.description}
                      {(departments.length > 0 || entry.department) && !isVoid && (
                        <select
                          value={entry.department?.id ?? ""}
                          onChange={(e) => changeDepartment(entry, e.target.value)}
                          className="mt-1 block max-w-[10rem] rounded border px-1 py-0.5 text-xs text-slate-600"
                          aria-label="部門"
                        >
                          <option value="">部門なし</option>
                          {entry.department && !departments.some((d) => d.id === entry.department!.id) && (
                            <option value={entry.department.id}>{entry.department.name}(停止中)</option>
                          )}
                          {departments.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td className="px-4 py-2">{side("debit")}</td>
                    <td className="px-4 py-2">{side("credit")}</td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                        {SOURCE_LABELS[entry.sourceType] ?? entry.sourceType}
                      </span>
                      {isVoid && <span className="ml-1 text-xs text-rose-600">取消済み</span>}
                      {entry.status === "PENDING_REVIEW" && <span className="ml-1 text-xs text-amber-700">レビュー待ち</span>}
                    </td>
                    <td className="space-x-3 px-4 py-2 text-right whitespace-nowrap">
                      {!isVoid && (
                        <button type="button" onClick={() => duplicate(entry)} className="text-xs text-indigo-700 hover:underline">
                          複製
                        </button>
                      )}
                      {["MANUAL", "RECURRING", "IMPORT"].includes(entry.sourceType) && !isVoid && (
                        <button type="button" onClick={() => handleVoid(entry)} className="text-xs text-rose-600 hover:underline">
                          取消
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {entries && entries.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                    {searching ? "条件に合う仕訳はありません。" : month ? "この月の仕訳はありません。" : "まだ仕訳がありません。"}
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

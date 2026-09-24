"use client";

import { Suspense, useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { formatYen } from "@/lib/format";

type Item = {
  id: string;
  name: string;
  issueDay: number;
  dueDays: number | null;
  startMonth: string;
  endMonth: string | null;
  active: boolean;
  template: { id: string; invoiceNumber: string | null; totalAmount: number; customerName: string };
  runs: { month: string; invoiceId: string; invoiceNumber: string | null; status: string }[];
  due: string[];
};
type Template = { id: string; invoiceNumber: string | null; totalAmount: number; issueDate: string | null; customer: { name: string } | null };

const inputClass = "mt-1 block w-full rounded-md border px-2 py-1.5 text-sm text-slate-900";

function thisMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(m: string) {
  return `${m.slice(0, 4)}年${Number(m.slice(5))}月`;
}

export default function RecurringInvoicesPage() {
  return (
    <Suspense>
      <RecurringInvoices />
    </Suspense>
  );
}

function RecurringInvoices() {
  const searchParams = useSearchParams();
  const [items, setItems] = useState<Item[] | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  // 請求書の画面の「毎月の定期請求にする」から来たら、その請求書をひな形にした入力欄を開いておく
  const [draft, setDraft] = useState(() => {
    const template = searchParams.get("template");
    return template ? { name: "", templateInvoiceId: template, issueDay: "25", dueRule: "next-month-end", dueDays: "30", startMonth: thisMonth(), endMonth: "" } : null;
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/recurring-invoices");
    const body = res.ok ? await res.json() : { items: [], templates: [] };
    setItems(body.items);
    setTemplates(body.templates);
  }, []);

  useEffect(() => {
    // Fetch-on-mount: setState always lands after the fetch's await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function call(url: string, init: RequestInit, success: string | ((b: Record<string, unknown>) => string)) {
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

  const selected = templates.find((t) => t.id === draft?.templateInvoiceId);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    // 名前を空欄のままにしたら「顧客名 月額」にする
    const name = draft.name || (selected?.customer ? `${selected.customer.name} 月額` : "");
    const ok = await call(
      "/api/recurring-invoices",
      {
        method: "POST",
        body: JSON.stringify({
          name,
          templateInvoiceId: draft.templateInvoiceId,
          issueDay: Number(draft.issueDay),
          dueDays: draft.dueRule === "days" ? Number(draft.dueDays) : null,
          startMonth: draft.startMonth,
          endMonth: draft.endMonth,
        }),
      },
      `「${name}」を登録しました`,
    );
    if (ok) setDraft(null);
  }

  const totalDue = (items ?? []).reduce((s, r) => s + r.due.length, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link href="/invoices" className="text-sm text-indigo-700 hover:underline">
            ← 請求書
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">定期請求</h1>
          <p className="mt-1 text-sm text-slate-600">
            顧問料・保守料・家賃収入など、毎月同じ内容の請求書を、ひな形の請求書から毎月作ります(売上の仕訳も自動)。請求日が来たらボタン1つで作成できます。
          </p>
        </div>
        {!draft && (
          <button
            onClick={() => setDraft({ name: "", templateInvoiceId: "", issueDay: "25", dueRule: "next-month-end", dueDays: "30", startMonth: thisMonth(), endMonth: "" })}
            className="self-start rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium whitespace-nowrap text-white shadow-sm hover:bg-indigo-700"
          >
            + 定期請求を登録
          </button>
        )}
      </div>

      {message && (
        <div className={`rounded-md px-4 py-2 text-sm ${message.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"}`}>{message.text}</div>
      )}

      {totalDue > 0 && !draft && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm text-amber-900">請求日が来ている未作成の請求書が {totalDue} 件あります。</p>
          <button
            onClick={() =>
              call("/api/recurring-invoices/issue-due", { method: "POST" }, (b) =>
                `${b.issued}件の請求書を作成しました${Array.isArray(b.errors) && b.errors.length ? `(失敗: ${(b.errors as string[]).join(" / ")})` : ""}`,
              )
            }
            disabled={busy}
            className="rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
          >
            まとめて作成する
          </button>
        </div>
      )}

      {draft && (
        <form onSubmit={save} className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="font-semibold">定期請求を登録</h2>
          {templates.length === 0 ? (
            <p className="text-sm text-slate-600">
              先に「請求書を作成」で、ひな形にする請求書を1枚作ってください。
              <Link href="/invoices/new" className="ml-1 text-indigo-700 hover:underline">
                請求書を作成
              </Link>
            </p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs text-slate-500">
                  ひな形にする請求書(宛先・明細・備考を写します)
                  <select
                    value={draft.templateInvoiceId}
                    onChange={(e) => {
                      const t = templates.find((x) => x.id === e.target.value);
                      setDraft({ ...draft, templateInvoiceId: e.target.value, name: draft.name || (t?.customer ? `${t.customer.name} 月額` : "") });
                    }}
                    required
                    className={inputClass}
                  >
                    <option value="">選択してください</option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.invoiceNumber} {t.customer?.name} {formatYen(t.totalAmount)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-slate-500">
                  名前
                  <input
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    placeholder={selected?.customer ? `${selected.customer.name} 月額` : "例: A社 保守料"}
                    className={inputClass}
                  />
                </label>
                <label className="text-xs text-slate-500">
                  請求日
                  <select value={draft.issueDay} onChange={(e) => setDraft({ ...draft, issueDay: e.target.value })} className={inputClass}>
                    {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                      <option key={d} value={d}>
                        毎月{d}日
                      </option>
                    ))}
                    <option value="0">毎月末</option>
                  </select>
                </label>
                <label className="text-xs text-slate-500">
                  お支払期限
                  <span className="mt-1 flex items-center gap-2">
                    <select value={draft.dueRule} onChange={(e) => setDraft({ ...draft, dueRule: e.target.value })} className="rounded-md border px-2 py-1.5 text-sm text-slate-900">
                      <option value="next-month-end">翌月末</option>
                      <option value="days">請求日から</option>
                    </select>
                    {draft.dueRule === "days" && (
                      <>
                        <input type="number" min={0} max={365} value={draft.dueDays} onChange={(e) => setDraft({ ...draft, dueDays: e.target.value })} className="w-20 rounded-md border px-2 py-1.5 text-sm text-slate-900" />
                        <span className="text-sm text-slate-700">日後</span>
                      </>
                    )}
                  </span>
                </label>
                <label className="text-xs text-slate-500">
                  開始月
                  <input type="month" value={draft.startMonth} onChange={(e) => setDraft({ ...draft, startMonth: e.target.value })} required className={inputClass} />
                </label>
                <label className="text-xs text-slate-500">
                  終了月(任意)
                  <input type="month" value={draft.endMonth} onChange={(e) => setDraft({ ...draft, endMonth: e.target.value })} className={inputClass} />
                </label>
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setDraft(null)} className="rounded-md border px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
                  キャンセル
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-md bg-indigo-600 px-5 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
                >
                  登録する
                </button>
              </div>
            </>
          )}
        </form>
      )}

      {items === null ? (
        <p className="text-sm text-slate-500">読み込み中...</p>
      ) : items.length === 0 ? (
        !draft && <p className="rounded-xl border border-dashed p-6 text-center text-sm text-slate-500">まだ定期請求はありません。</p>
      ) : (
        <div className="space-y-3">
          {items.map((r) => (
            <div key={r.id} className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm ${r.active ? "" : "opacity-60"}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{r.name}</span>
                    <span className="text-sm tabular-nums">{formatYen(r.template.totalAmount)}</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{r.issueDay === 0 ? "毎月末" : `毎月${r.issueDay}日`}</span>
                    {!r.active && <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-600">停止中</span>}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {r.template.customerName} 御中 ・ ひな形{" "}
                    <Link href={`/invoices/${r.template.id}/print`} className="text-indigo-700 hover:underline">
                      {r.template.invoiceNumber}
                    </Link>{" "}
                    ・ 支払期限 {r.dueDays === null ? "翌月末" : `請求日から${r.dueDays}日後`}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {monthLabel(r.startMonth)}から{r.endMonth ? `${monthLabel(r.endMonth)}まで` : ""}
                    {r.runs.length > 0 &&
                      ` ・ 作成済み: ${r.runs
                        .slice(0, 3)
                        .map((run) => `${monthLabel(run.month)}(${run.invoiceNumber}${run.status === "CANCELLED" ? "・取消" : ""})`)
                        .join("、")}`}
                  </p>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <button
                    onClick={() => call(`/api/recurring-invoices/${r.id}`, { method: "PATCH", body: JSON.stringify({ active: !r.active }) }, r.active ? `「${r.name}」を停止しました` : `「${r.name}」を再開しました`)}
                    className="text-slate-600 hover:underline"
                  >
                    {r.active ? "停止" : "再開"}
                  </button>
                  <button
                    onClick={() => window.confirm(`「${r.name}」を削除しますか?(作成済みの請求書は残ります)`) && call(`/api/recurring-invoices/${r.id}`, { method: "DELETE" }, `「${r.name}」を削除しました`)}
                    className="text-rose-600 hover:underline"
                  >
                    削除
                  </button>
                </div>
              </div>
              {r.due.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
                  <span className="text-xs text-amber-800">未作成:</span>
                  {r.due.map((m) => (
                    <button
                      key={m}
                      onClick={() => call(`/api/recurring-invoices/${r.id}/issue`, { method: "POST", body: JSON.stringify({ month: m }) }, (b) => `${monthLabel(m)}分の請求書 ${b.invoiceNumber} を作成しました`)}
                      disabled={busy}
                      className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
                    >
                      {monthLabel(m)}分を作成
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

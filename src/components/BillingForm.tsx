"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatYen } from "@/lib/format";

export type FormLine = { description: string; quantity: string; unit: string; unitPrice: string; taxRate: string };
type Line = FormLine;
export type BillingFormInitial = { customerName: string; lines: FormLine[]; notes: string; issueDate?: string; dueDate?: string; departmentId?: string | null };
// 請求書の訂正(元の請求書の番号・入金済みの額)
export type BillingCorrection = { id: string; number: string; paid: number };

const emptyLine = (): Line => ({ description: "", quantity: "1", unit: "", unitPrice: "", taxRate: "10" });

function dateKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// 支払期限の初期値は翌月末(よくある「月末締め翌月末払い」)、見積書の有効期限は1か月後
function endOfNextMonth(d: Date) {
  return dateKey(new Date(d.getFullYear(), d.getMonth() + 2, 0));
}

function oneMonthLater(d: Date) {
  return dateKey(new Date(d.getFullYear(), d.getMonth() + 1, d.getDate()));
}

const TEXT = {
  invoice: {
    title: "請求書を作成",
    back: { href: "/invoices", label: "← 請求書一覧" },
    lead: "作成すると「売掛金 / 売上高・仮受消費税」の仕訳を自動で記帳し、印刷・PDF保存用の請求書を表示します。消費税は税率ごとに合計してから計算します(インボイス制度の方式)。",
    customer: "請求先(会社名・氏名)",
    issueDate: "請求日",
    deadline: "お支払期限",
    total: "ご請求金額(税込)",
    endpoint: "/api/invoices/issue",
    printPath: (id: string) => `/invoices/${id}/print`,
  },
  quote: {
    title: "見積書を作成",
    back: { href: "/quotes", label: "← 見積書一覧" },
    lead: "見積書は仕訳を作りません。受注したら見積書の画面の「請求書にする」で、同じ内容の請求書(売上の仕訳つき)を作れます。",
    customer: "見積先(会社名・氏名)",
    issueDate: "見積日",
    deadline: "有効期限",
    total: "お見積金額(税込)",
    endpoint: "/api/quotes",
    printPath: (id: string) => `/quotes/${id}`,
  },
} as const;

const inputClass = "w-full rounded-md border px-2 py-1.5 text-sm";

export function BillingForm({ kind, initial, correction }: { kind: "invoice" | "quote"; initial?: BillingFormInitial | null; correction?: BillingCorrection | null }) {
  const text = correction
    ? {
        ...TEXT.invoice,
        title: "請求書を訂正",
        back: { href: `/invoices/${correction.id}/print`, label: "← 元の請求書に戻る" },
        lead: `請求書 ${correction.number} を訂正します。元の請求書は「取消」になり(売上の仕訳も取り消し)、直した内容で訂正版(${correction.number}-R1 のような番号)を発行します。入金の記録と、お客さまに送った共有リンクは訂正版に引き継ぎます。`,
        endpoint: `/api/invoices/${correction.id}/correct`,
      }
    : TEXT[kind];
  const [reason, setReason] = useState("");
  const router = useRouter();
  const [customers, setCustomers] = useState<{ id: string; name: string }[]>([]);
  const [customerName, setCustomerName] = useState(initial?.customerName ?? "");
  const [issueDate, setIssueDate] = useState(() => initial?.issueDate ?? dateKey(new Date()));
  const [dueDate, setDueDate] = useState(() => initial?.dueDate ?? (kind === "invoice" ? endOfNextMonth(new Date()) : oneMonthLater(new Date())));
  const [lines, setLines] = useState<Line[]>(initial?.lines.length ? initial.lines : [emptyLine()]);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [departmentId, setDepartmentId] = useState(initial?.departmentId ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/customers").then(async (res) => setCustomers(res.ok ? await res.json() : []));
    // 請求書は売上の仕訳を作るので、部門を付けられる
    if (kind === "invoice") {
      fetch("/api/departments").then(async (res) => {
        const list: { id: string; name: string; active: boolean }[] = res.ok ? await res.json() : [];
        setDepartments(list.filter((d) => d.active));
      });
    }
  }, [kind]);

  const priced = lines.map((l) => {
    const amount = Math.floor(Math.round(Number(l.quantity || 0) * Number(l.unitPrice || 0) * 1e6) / 1e6);
    return { ...l, amount: Number.isFinite(amount) ? amount : 0 };
  });
  const byRate = [10, 8]
    .map((rate) => {
      const base = priced.filter((l) => Number(l.taxRate) === rate).reduce((s, l) => s + l.amount, 0);
      return { rate, base, tax: Math.floor((base * rate) / 100) };
    })
    .filter((r) => r.base !== 0);
  const subtotal = byRate.reduce((s, r) => s + r.base, 0);
  const tax = byRate.reduce((s, r) => s + r.tax, 0);

  function update(i: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(text.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerName, issueDate, dueDate, validUntil: dueDate, notes, lines, departmentId: departmentId || null, ...(correction ? { reason } : {}) }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "作成に失敗しました");
      router.push(text.printPath(body.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href={text.back.href} className="text-sm text-indigo-700 hover:underline">
          {text.back.label}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">{text.title}</h1>
        <p className="mt-1 text-sm text-slate-600">{text.lead}</p>
      </div>

      {error && <div className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</div>}

      <form onSubmit={submit} className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="sm:col-span-3 lg:col-span-1">
            <label className="mb-1 block text-xs text-slate-500">{text.customer}</label>
            <input list="customers" value={customerName} onChange={(e) => setCustomerName(e.target.value)} required className={inputClass} placeholder="株式会社〇〇" />
            <datalist id="customers">
              {customers.map((c) => (
                <option key={c.id} value={c.name} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-500">{text.issueDate}</label>
            <input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} required className={inputClass} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-500">{text.deadline}</label>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required className={inputClass} />
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
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="text-left text-xs whitespace-nowrap text-slate-500">
              <tr>
                <th className="pr-2 pb-1 font-medium">品目</th>
                <th className="w-20 pr-2 pb-1 font-medium">数量</th>
                <th className="w-20 pr-2 pb-1 font-medium">単位</th>
                <th className="w-28 pr-2 pb-1 font-medium">単価(税抜)</th>
                <th className="w-24 pr-2 pb-1 font-medium">税率</th>
                <th className="w-28 pr-2 pb-1 text-right font-medium">金額</th>
                <th className="w-6" />
              </tr>
            </thead>
            <tbody>
              {priced.map((l, i) => (
                <tr key={i} className="hover:bg-transparent">
                  <td className="py-1 pr-2">
                    <input value={l.description} onChange={(e) => update(i, { description: e.target.value })} className={inputClass} placeholder="例: Webサイト制作費" />
                  </td>
                  <td className="py-1 pr-2">
                    <input type="number" min={0} step="any" value={l.quantity} onChange={(e) => update(i, { quantity: e.target.value })} className={`${inputClass} text-right`} />
                  </td>
                  <td className="py-1 pr-2">
                    <input value={l.unit} onChange={(e) => update(i, { unit: e.target.value })} className={inputClass} placeholder="式" />
                  </td>
                  <td className="py-1 pr-2">
                    <input type="number" min={0} step={1} value={l.unitPrice} onChange={(e) => update(i, { unitPrice: e.target.value })} className={`${inputClass} text-right`} />
                  </td>
                  <td className="py-1 pr-2">
                    <select value={l.taxRate} onChange={(e) => update(i, { taxRate: e.target.value })} className={inputClass}>
                      <option value="10">10%</option>
                      <option value="8">8%(軽減)</option>
                    </select>
                  </td>
                  <td className="py-1 pr-2 text-right whitespace-nowrap tabular-nums">{formatYen(l.amount)}</td>
                  <td className="py-1 text-center">
                    {lines.length > 1 && (
                      <button type="button" onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))} className="text-slate-400 hover:text-rose-600" aria-label="行を削除">
                        ×
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button type="button" onClick={() => setLines((prev) => [...prev, emptyLine()])} className="text-xs font-medium text-indigo-700 hover:underline">
          + 行を追加
        </button>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs text-slate-500">備考(任意)</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className={inputClass} />
          </div>
          <dl className="space-y-1 self-end text-sm">
            {byRate.map((r) => (
              <div key={r.rate} className="flex justify-between text-slate-600">
                <dt>
                  {r.rate}%対象 {formatYen(r.base)} の消費税
                </dt>
                <dd className="tabular-nums">{formatYen(r.tax)}</dd>
              </div>
            ))}
            <div className="flex justify-between text-slate-600">
              <dt>小計(税抜)</dt>
              <dd className="tabular-nums">{formatYen(subtotal)}</dd>
            </div>
            <div className="flex justify-between border-t pt-1 text-base font-semibold">
              <dt>{text.total}</dt>
              <dd className="tabular-nums">{formatYen(subtotal + tax)}</dd>
            </div>
          </dl>
        </div>

        {correction && (
          <div className="grid gap-3 border-t pt-4 sm:grid-cols-2">
            <label className="block text-xs text-slate-500">
              訂正の理由(任意・訂正版の請求書に記載します)
              <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="例: 数量の誤りのため" className={`${inputClass} mt-1 text-slate-900`} />
            </label>
            {correction.paid > 0 && (
              <p className="self-end rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
                この請求書には {formatYen(correction.paid)} の入金が記録されています。入金は訂正版に引き継ぐので、合計はこの金額以上にしてください。
              </p>
            )}
          </div>
        )}

        <div className="flex justify-end">
          <button type="submit" disabled={saving} className="rounded-md bg-indigo-600 px-5 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50">
            {saving ? "作成中..." : correction ? "訂正版を発行する" : text.title}
          </button>
        </div>
      </form>
    </div>
  );
}

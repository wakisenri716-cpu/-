"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PrintButton } from "@/components/PrintButton";

function dateKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function PurchaseOrderActions({
  orderId,
  status,
  accounts,
  defaultAccountCode,
  canUndo,
  projects,
}: {
  orderId: string;
  status: "OPEN" | "RECEIVED" | "CANCELLED";
  accounts: { code: string; name: string }[];
  defaultAccountCode: string;
  canUndo: boolean;
  projects: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [receivedDate, setReceivedDate] = useState(() => dateKey(new Date()));
  // 支払期日の初期値は翌月末(月末締め翌月末払い)
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date();
    return dateKey(new Date(d.getFullYear(), d.getMonth() + 2, 0));
  });
  const [accountCode, setAccountCode] = useState(defaultAccountCode);
  const [vendorInvoiceNumber, setVendorInvoiceNumber] = useState("");
  const [projectId, setProjectId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function post(body: object) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/purchase-orders/${orderId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error || "処理に失敗しました");
      return false;
    }
    router.refresh();
    return true;
  }

  async function receive() {
    if (await post({ action: "receive", receivedDate, dueDate, accountCode, vendorInvoiceNumber, projectId })) setOpen(false);
  }

  async function undo() {
    if (!window.confirm("検収を取り消しますか?(計上した買掛金と仕訳は取消になり、発注済みに戻ります)")) return;
    await post({ action: "undo" });
  }

  async function cancel() {
    if (!window.confirm("この発注書を取り消しますか?")) return;
    await post({ action: "cancel" });
  }

  const inputClass = "mt-1 block rounded-md border bg-white px-2 py-1.5 text-sm";

  return (
    <div className="space-y-3 print:hidden">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Link href={`/purchase-orders/new?from=${orderId}`} className="rounded-md border px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
          複製して作成
        </Link>
        {status === "OPEN" && (
          <>
            <button onClick={cancel} disabled={busy} className="rounded-md border border-rose-200 px-3 py-2 text-sm text-rose-700 hover:bg-rose-50 disabled:opacity-50">
              取り消す
            </button>
            <button onClick={() => setOpen((v) => !v)} className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-700">
              検収する
            </button>
          </>
        )}
        {status === "RECEIVED" && canUndo && (
          <button onClick={undo} disabled={busy} className="rounded-md border px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50">
            検収を取り消す
          </button>
        )}
        {status !== "CANCELLED" && <PrintButton />}
      </div>
      {error && <div className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</div>}
      {open && status === "OPEN" && (
        <div className="flex flex-wrap items-end justify-end gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="w-full text-sm text-emerald-900">
            納品を確かめたら検収します。この発注書の金額で「{accounts.find((a) => a.code === accountCode)?.name ?? "仕入"}・仮払消費税 / 買掛金」の仕訳を記帳し、支払待ちの請求書として登録します。
          </p>
          <label className="text-xs text-slate-600">
            検収日
            <input type="date" value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} className={inputClass} />
          </label>
          <label className="text-xs text-slate-600">
            支払期日
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputClass} />
          </label>
          <label className="text-xs text-slate-600">
            勘定科目
            <select value={accountCode} onChange={(e) => setAccountCode(e.target.value)} className={inputClass}>
              {accounts.map((a) => (
                <option key={a.code} value={a.code}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          {projects.length > 0 && (
            <label className="text-xs text-slate-600">
              案件(任意)
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={inputClass}>
                <option value="">なし</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="text-xs text-slate-600">
            相手の請求書番号(任意)
            <input value={vendorInvoiceNumber} onChange={(e) => setVendorInvoiceNumber(e.target.value)} maxLength={50} className={inputClass} />
          </label>
          <button onClick={receive} disabled={busy} className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
            {busy ? "計上中..." : "検収して計上"}
          </button>
        </div>
      )}
    </div>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CsvImportForm } from "@/components/CsvImportForm";
import { PrintButton } from "@/components/PrintButton";

type Account = { id: string; code: string; name: string };
type Vendor = {
  id: string;
  name: string;
  defaultExpenseAccountId: string | null;
  defaultExpenseAccount: Account | null;
};
type Customer = { id: string; name: string };

export default function VendorsPage() {
  const [tab, setTab] = useState<"vendors" | "customers">("vendors");
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [vendorsRes, customersRes, accountsRes] = await Promise.all([
      fetch("/api/vendors"),
      fetch("/api/customers"),
      fetch("/api/accounts"),
    ]);
    setVendors(await vendorsRes.json());
    setCustomers(await customersRes.json());
    setAccounts(await accountsRes.json());
    setLoading(false);
  }

  useEffect(() => {
    // Fetch-on-mount: the resulting setState always lands after the fetch's
    // await, so the extra render this rule warns about never happens here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  async function saveVendorName(id: string) {
    const name = drafts[id];
    if (!name || !name.trim()) return;
    setSavingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/vendors/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "更新に失敗しました");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
    } finally {
      setSavingId(null);
    }
  }

  async function saveVendorAccount(id: string, accountId: string) {
    setSavingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/vendors/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultExpenseAccountId: accountId || null }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "更新に失敗しました");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
    } finally {
      setSavingId(null);
    }
  }

  async function saveCustomerName(id: string) {
    const name = drafts[id];
    if (!name || !name.trim()) return;
    setSavingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/customers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "更新に失敗しました");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-2xl font-semibold">取引先・顧客</h1>
          <PrintButton variant="outline" />
        </div>
        <p className="mt-1 text-sm text-slate-600">
          経費精算・請求書のAI処理で自動的に登録された取引先/顧客の一覧です。取引先に「既定の勘定科目」を
          設定しておくと、その取引先からの領収書・請求書はAIの判定よりも優先してその科目で仕訳されます。
        </p>
      </div>

      <CsvImportForm
        endpoint="/api/vendors/import"
        title="CSVでまとめて登録"
        hint="「種類(取引先/顧客)・名前・既定の勘定科目」の列があるCSVを読み込みます。同じ名前がすでにあれば、既定の勘定科目だけ更新します。"
        onDone={load}
      />

      <div className="flex gap-2 border-b">
        <button
          onClick={() => setTab("vendors")}
          className={`px-3 py-2 text-sm font-medium ${
            tab === "vendors" ? "border-b-2 border-indigo-600 text-indigo-700" : "text-slate-500"
          }`}
        >
          取引先(仕入・経費)
        </button>
        <button
          onClick={() => setTab("customers")}
          className={`px-3 py-2 text-sm font-medium ${
            tab === "customers" ? "border-b-2 border-indigo-600 text-indigo-700" : "text-slate-500"
          }`}
        >
          顧客(売上)
        </button>
      </div>

      {error && <div className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</div>}

      {loading ? (
        <p className="text-sm text-slate-500">読み込み中...</p>
      ) : tab === "vendors" ? (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-2">取引先名</th>
                  <th className="px-4 py-2">既定の勘定科目</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {vendors.map((vendor) => (
                  <tr key={vendor.id}>
                    <td className="px-4 py-2">
                      <input
                        defaultValue={vendor.name}
                        onChange={(e) => setDrafts((prev) => ({ ...prev, [vendor.id]: e.target.value }))}
                        onBlur={() => saveVendorName(vendor.id)}
                        className="w-48 rounded border px-2 py-1 text-sm"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <select
                        defaultValue={vendor.defaultExpenseAccountId ?? ""}
                        onChange={(e) => saveVendorAccount(vendor.id, e.target.value)}
                        disabled={savingId === vendor.id}
                        className="w-56 rounded border px-2 py-1 text-sm"
                      >
                        <option value="">(未設定・AIに任せる)</option>
                        {accounts.map((account) => (
                          <option key={account.id} value={account.id}>
                            {account.code} {account.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-2 text-xs whitespace-nowrap text-slate-400">
                      {savingId === vendor.id ? (
                        "保存中..."
                      ) : (
                        <Link href={`/vendors/vendor/${vendor.id}`} className="text-indigo-700 hover:underline">
                          取引の履歴
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
                {vendors.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-slate-400">
                      まだ取引先がありません。経費精算や受領請求書をAI処理すると自動的に登録されます。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-2">顧客名</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {customers.map((customer) => (
                  <tr key={customer.id}>
                    <td className="px-4 py-2">
                      <input
                        defaultValue={customer.name}
                        onChange={(e) => setDrafts((prev) => ({ ...prev, [customer.id]: e.target.value }))}
                        onBlur={() => saveCustomerName(customer.id)}
                        className="w-48 rounded border px-2 py-1 text-sm"
                      />
                    </td>
                    <td className="px-4 py-2 text-xs whitespace-nowrap text-slate-400">
                      {savingId === customer.id ? (
                        "保存中..."
                      ) : (
                        <Link href={`/vendors/customer/${customer.id}`} className="text-indigo-700 hover:underline">
                          取引の履歴
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
                {customers.length === 0 && (
                  <tr>
                    <td colSpan={2} className="px-4 py-6 text-center text-slate-400">
                      まだ顧客がありません。発行請求書をAI処理すると自動的に登録されます。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

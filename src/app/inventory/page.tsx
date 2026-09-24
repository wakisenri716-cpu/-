"use client";

import { useEffect, useState, type FormEvent } from "react";
import { formatDate, formatYen } from "@/lib/format";
import { CsvDownloadLink } from "@/components/CsvDownloadLink";
import { CsvImportForm } from "@/components/CsvImportForm";

type MovementType = "PURCHASE" | "ISSUE" | "STOCKTAKE";

type Product = {
  id: string;
  code: string | null;
  name: string;
  unit: string;
  quantityOnHand: number;
  inventoryValue: number;
  averageUnitCost: number;
  reorderPoint: number | null;
};

// 在庫切れ、または発注点以下になった商品
function needsOrder(p: Product) {
  return p.quantityOnHand <= (p.reorderPoint ?? 0);
}

type Movement = {
  id: string;
  type: MovementType;
  date: string;
  quantity: number;
  amount: number;
  memo: string | null;
  journalEntryId: string | null;
  product: { name: string; unit: string };
};

type Inventory = { products: Product[]; movements: Movement[]; totalValue: number };

const TYPE_TABS: { key: MovementType; label: string; hint: string }[] = [
  { key: "PURCHASE", label: "入庫(仕入)", hint: "仕入れた数と単価を入力すると「商品」に計上し、支払方法に応じて現金・預金・買掛金の仕訳を作ります。" },
  { key: "ISSUE", label: "出庫", hint: "売れた・使った数を入力すると、平均単価で計算した金額を「売上原価」に振り替えます。" },
  { key: "STOCKTAKE", label: "棚卸", hint: "実際に数えた数を入力すると、帳簿との差を「売上原価」で調整します(減っていれば原価に計上)。" },
];

const TYPE_BADGES: Record<MovementType, { label: string; className: string }> = {
  PURCHASE: { label: "入庫", className: "bg-emerald-100 text-emerald-800" },
  ISSUE: { label: "出庫", className: "bg-blue-100 text-blue-800" },
  STOCKTAKE: { label: "棚卸", className: "bg-amber-100 text-amber-800" },
};

const PAYMENT_OPTIONS = [
  { code: "2010", label: "買掛金(後払い)" },
  { code: "1010", label: "現金" },
  { code: "1020", label: "普通預金" },
];

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function signed(n: number, suffix = ""): string {
  return `${n > 0 ? "+" : ""}${n.toLocaleString("ja-JP")}${suffix}`;
}

const inputClass = "w-full rounded-md border px-2.5 py-1.5 text-sm";
const labelClass = "block text-xs text-slate-500 mb-1";

export default function InventoryPage() {
  const [data, setData] = useState<Inventory | null>(null);
  const [type, setType] = useState<MovementType>("PURCHASE");
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [taxable, setTaxable] = useState(true);
  const [creating, setCreating] = useState(false);
  const [recording, setRecording] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/inventory");
    setData(await res.json());
  }

  useEffect(() => {
    // Fetch-on-mount: the resulting setState always lands after the fetch's
    // await, so the extra render this rule warns about never happens here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  async function saveReorderPoint(id: string, reorderPoint: number | null) {
    setError(null);
    const res = await fetch(`/api/inventory/products/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reorderPoint }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error || "発注点を保存できませんでした");
    }
    await load();
  }

  const products = data?.products ?? [];
  const selected = products.find((p) => p.id === productId);
  const qty = Number(quantity);
  const cost = Number(unitCost);
  const purchaseAmount = Number.isFinite(qty * cost) ? qty * cost : 0;
  const activeTab = TYPE_TABS.find((t) => t.key === type)!;

  async function handleCreateProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setCreating(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/inventory/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(formData)),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "登録に失敗しました");
      form.reset();
      setProductId(body.id);
      setMessage(`「${body.name}」を登録しました。続けて入庫を記録してください。`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
    } finally {
      setCreating(false);
    }
  }

  async function handleRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setRecording(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/inventory/movements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          productId,
          quantity,
          unitCost,
          taxable,
          date: formData.get("date"),
          paymentAccountCode: formData.get("paymentAccountCode"),
          memo: formData.get("memo"),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "記録に失敗しました");
      setQuantity("");
      setUnitCost("");
      setMessage(
        `${TYPE_BADGES[type].label}を記録しました。${body.product.name} の在庫は ${body.product.quantityOnHand}${body.product.unit} です` +
          (body.journalEntryId ? "(仕訳を自動記帳しました)" : "(差異がないため仕訳はありません)"),
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
    } finally {
      setRecording(false);
    }
  }

  const stats = [
    { label: "在庫金額(合計)", value: formatYen(data?.totalValue ?? 0) },
    { label: "登録商品数", value: `${products.length}` },
    { label: "発注が必要な商品", value: `${products.filter(needsOrder).length}` },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">在庫管理</h1>
          <p className="mt-1 text-sm text-slate-600">
            商品ごとの在庫数と金額を管理します。在庫金額は貸借対照表の「商品」に、出庫や棚卸で減った分は損益計算書の「売上原価」に自動で反映されます(移動平均法)。
          </p>
        </div>
        <CsvDownloadLink href="/api/inventory/export" />
      </div>

      {error && <div className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</div>}
      {message && <div className="rounded-md bg-emerald-50 px-4 py-2 text-sm text-emerald-800">{message}</div>}

      <CsvImportForm
        endpoint="/api/inventory/products/import"
        title="商品をCSVでまとめて登録"
        hint="「商品名・コード・単位・発注点」の列があるCSVを読み込みます。同じ名前の商品があれば、コード・単位・発注点を更新します(在庫数は入庫・棚卸で入れてください)。"
        onDone={load}
      />

      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
            <div className="text-lg font-semibold text-slate-900 sm:text-2xl">{stat.value}</div>
            <div className="mt-0.5 text-xs text-slate-500">{stat.label}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm lg:col-span-2">
          <h2 className="font-semibold">在庫を記録</h2>
          <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
            {TYPE_TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setType(tab.key)}
                className={`flex-1 rounded-md px-2 py-1.5 text-sm font-medium whitespace-nowrap ${
                  type === tab.key ? "bg-white text-indigo-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-500">{activeTab.hint}</p>

          <form onSubmit={handleRecord} className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={labelClass}>商品</label>
              <select value={productId} onChange={(e) => setProductId(e.target.value)} required className={inputClass}>
                <option value="">選択してください</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code ? `${p.code} ` : ""}
                    {p.name}(在庫 {p.quantityOnHand}
                    {p.unit})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>日付</label>
              <input type="date" name="date" defaultValue={today()} required className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>
                {type === "PURCHASE" ? "入庫数" : type === "ISSUE" ? "出庫数" : "実際に数えた数"}
                {selected && ` (${selected.unit})`}
              </label>
              <input
                type="number"
                min={type === "STOCKTAKE" ? 0 : 1}
                step={1}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                required
                className={inputClass}
              />
            </div>
            {type === "PURCHASE" && (
              <>
                <div>
                  <label className={labelClass}>仕入単価(税抜・円)</label>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={unitCost}
                    onChange={(e) => setUnitCost(e.target.value)}
                    required
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>支払方法</label>
                  <select name="paymentAccountCode" defaultValue="2010" className={inputClass}>
                    {PAYMENT_OPTIONS.map((o) => (
                      <option key={o.code} value={o.code}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2">
                  <input type="checkbox" checked={taxable} onChange={(e) => setTaxable(e.target.checked)} />
                  消費税10%を仮払消費税として計上する
                </label>
              </>
            )}
            <div className="sm:col-span-2">
              <label className={labelClass}>メモ(任意)</label>
              <input type="text" name="memo" className={inputClass} />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 sm:col-span-2">
              <p className="text-xs text-slate-500">
                {type === "PURCHASE" && purchaseAmount > 0 && (
                  <>
                    仕入金額 {formatYen(purchaseAmount)}
                    {taxable && ` + 消費税 ${formatYen(Math.floor(purchaseAmount * 0.1))}`}
                  </>
                )}
                {type === "ISSUE" && selected && `現在の在庫: ${selected.quantityOnHand}${selected.unit}`}
                {type === "STOCKTAKE" && selected && quantity !== "" && (
                  <>
                    帳簿 {selected.quantityOnHand}
                    {selected.unit} との差: {signed(qty - selected.quantityOnHand, selected.unit)}
                  </>
                )}
              </p>
              <button
                type="submit"
                disabled={recording || products.length === 0}
                className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
              >
                {recording ? "記録中..." : `${TYPE_BADGES[type].label}を記録`}
              </button>
            </div>
          </form>
        </section>

        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="font-semibold">商品を登録</h2>
          <form onSubmit={handleCreateProduct} className="space-y-3">
            <div>
              <label className={labelClass}>商品名</label>
              <input type="text" name="name" required className={inputClass} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>商品コード(任意)</label>
                <input type="text" name="code" className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>単位</label>
                <input type="text" name="unit" placeholder="個" className={inputClass} />
              </div>
            </div>
            <button
              type="submit"
              disabled={creating}
              className="w-full rounded-md border border-indigo-600 px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
            >
              {creating ? "登録中..." : "商品を登録"}
            </button>
          </form>
        </section>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b px-4 py-3 text-sm font-semibold">在庫一覧</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs whitespace-nowrap uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2">コード</th>
                <th className="px-4 py-2">商品名</th>
                <th className="px-4 py-2 text-right">在庫数</th>
                <th className="px-4 py-2 text-right">発注点</th>
                <th className="px-4 py-2 text-right">平均単価</th>
                <th className="px-4 py-2 text-right">在庫金額</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {products.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-2 whitespace-nowrap text-slate-500">{p.code ?? "-"}</td>
                  <td className="px-4 py-2 whitespace-nowrap">{p.name}</td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    {p.quantityOnHand === 0 ? (
                      <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700">在庫切れ</span>
                    ) : (
                      <>
                        {`${p.quantityOnHand.toLocaleString("ja-JP")}${p.unit}`}
                        {needsOrder(p) && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">発注が必要</span>}
                      </>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    <input
                      type="number"
                      min={0}
                      defaultValue={p.reorderPoint ?? ""}
                      placeholder="未設定"
                      onBlur={(e) => {
                        const value = e.target.value === "" ? null : Number(e.target.value);
                        if (value !== p.reorderPoint) saveReorderPoint(p.id, value);
                      }}
                      className="w-20 rounded-md border px-2 py-1 text-right text-sm"
                      aria-label={`${p.name}の発注点`}
                    />
                  </td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">{formatYen(p.averageUnitCost)}</td>
                  <td className="px-4 py-2 text-right font-medium whitespace-nowrap">{formatYen(p.inventoryValue)}</td>
                </tr>
              ))}
              {data && products.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                    まだ商品が登録されていません。「商品を登録」から追加してください。
                  </td>
                </tr>
              )}
            </tbody>
            {products.length > 0 && (
              <tfoot className="border-t bg-slate-50 font-medium">
                <tr>
                  <td className="px-4 py-2" colSpan={5}>
                    合計
                  </td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">{formatYen(data?.totalValue ?? 0)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b px-4 py-3 text-sm font-semibold">入出庫の履歴</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs whitespace-nowrap uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2">日付</th>
                <th className="px-4 py-2">区分</th>
                <th className="px-4 py-2">商品</th>
                <th className="px-4 py-2 text-right">数量</th>
                <th className="px-4 py-2 text-right">金額</th>
                <th className="px-4 py-2">メモ</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data?.movements.map((m) => (
                <tr key={m.id}>
                  <td className="px-4 py-2 whitespace-nowrap">{formatDate(m.date)}</td>
                  <td className="px-4 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${TYPE_BADGES[m.type].className}`}>
                      {TYPE_BADGES[m.type].label}
                    </span>
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">{m.product.name}</td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">{signed(m.quantity, m.product.unit)}</td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    {m.amount === 0 ? "-" : `${m.amount > 0 ? "+" : "-"}${formatYen(Math.abs(m.amount))}`}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap text-slate-500">{m.memo ?? ""}</td>
                </tr>
              ))}
              {data && data.movements.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                    まだ記録がありません。
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

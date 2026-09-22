"use client";

import { useEffect, useState, type FormEvent } from "react";
import { formatDate, formatYen } from "@/lib/format";

type FixedAsset = {
  id: string;
  name: string;
  acquisitionDate: string;
  acquisitionCost: number;
  residualValue: number;
  usefulLifeYears: number;
  accumulatedDepreciation: number;
  bookValue: number;
  monthlyDepreciation: number;
  fullyDepreciated: boolean;
  depreciationEntries: { period: string; amount: number }[];
};

function currentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export default function AssetsPage() {
  const [assets, setAssets] = useState<FixedAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [depreciatingId, setDepreciatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/fixed-assets");
    setAssets(await res.json());
    setLoading(false);
  }

  useEffect(() => {
    // Fetch-on-mount: the resulting setState always lands after the fetch's
    // await, so the extra render this rule warns about never happens here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  async function handleRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/fixed-assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.get("name"),
          acquisitionDate: formData.get("acquisitionDate"),
          acquisitionCost: Number(formData.get("acquisitionCost")),
          usefulLifeYears: Number(formData.get("usefulLifeYears")),
          residualValue: formData.get("residualValue"),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "登録に失敗しました");
      form.reset();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
    } finally {
      setCreating(false);
    }
  }

  async function handleDepreciate(assetId: string) {
    setDepreciatingId(assetId);
    setError(null);
    try {
      const res = await fetch(`/api/fixed-assets/${assetId}/depreciate`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "計上に失敗しました");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
    } finally {
      setDepreciatingId(null);
    }
  }

  const period = currentPeriod();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">固定資産管理</h1>
        <p className="mt-1 text-sm text-slate-600">
          資産を登録すると取得の仕訳(固定資産/普通預金)が自動で記帳されます。「当月分を計上」を押すと
          定額法で計算した減価償却費(減価償却費/減価償却累計額)が記帳されます。同じ月に二重計上はできません。
        </p>
      </div>

      {error && <div className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</div>}

      <form onSubmit={handleRegister} className="flex flex-wrap items-end gap-3 rounded-lg border bg-white p-4">
        <div>
          <label className="block text-xs text-slate-500">資産名</label>
          <input name="name" required className="mt-1 w-40 rounded border px-2 py-1.5 text-sm" placeholder="ノートPC" />
        </div>
        <div>
          <label className="block text-xs text-slate-500">取得日</label>
          <input
            type="date"
            name="acquisitionDate"
            defaultValue={new Date().toISOString().slice(0, 10)}
            required
            className="mt-1 rounded border px-2 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-500">取得価額</label>
          <input
            type="number"
            name="acquisitionCost"
            required
            min={1}
            className="mt-1 w-28 rounded border px-2 py-1.5 text-sm"
            placeholder="300000"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-500">耐用年数(年)</label>
          <input
            type="number"
            name="usefulLifeYears"
            required
            min={1}
            className="mt-1 w-20 rounded border px-2 py-1.5 text-sm"
            placeholder="4"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-500">残存価額(任意)</label>
          <input type="number" name="residualValue" min={0} className="mt-1 w-24 rounded border px-2 py-1.5 text-sm" placeholder="1" />
        </div>
        <button
          type="submit"
          disabled={creating}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {creating ? "登録中..." : "資産を登録"}
        </button>
      </form>

      {loading ? (
        <p className="text-sm text-slate-500">読み込み中...</p>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-2">資産名</th>
                  <th className="px-4 py-2">取得日</th>
                  <th className="px-4 py-2 text-right">取得価額</th>
                  <th className="px-4 py-2 text-right">減価償却累計額</th>
                  <th className="px-4 py-2 text-right">帳簿価額</th>
                  <th className="px-4 py-2 text-right">月次償却額</th>
                  <th className="px-4 py-2">減価償却</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {assets.map((asset) => {
                  const alreadyPostedThisPeriod = asset.depreciationEntries.some((e) => e.period === period);
                  return (
                    <tr key={asset.id}>
                      <td className="px-4 py-2 whitespace-nowrap">{asset.name}</td>
                      <td className="px-4 py-2 whitespace-nowrap">{formatDate(asset.acquisitionDate)}</td>
                      <td className="px-4 py-2 text-right whitespace-nowrap">{formatYen(asset.acquisitionCost)}</td>
                      <td className="px-4 py-2 text-right whitespace-nowrap">{formatYen(asset.accumulatedDepreciation)}</td>
                      <td className="px-4 py-2 text-right whitespace-nowrap font-medium">{formatYen(asset.bookValue)}</td>
                      <td className="px-4 py-2 text-right whitespace-nowrap">{formatYen(asset.monthlyDepreciation)}</td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        {asset.fullyDepreciated ? (
                          <span className="text-xs text-slate-400">償却完了</span>
                        ) : alreadyPostedThisPeriod ? (
                          <span className="text-xs text-slate-400">{period} 計上済み</span>
                        ) : (
                          <button
                            onClick={() => handleDepreciate(asset.id)}
                            disabled={depreciatingId === asset.id}
                            className="rounded-md bg-slate-700 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
                          >
                            {period} 分を計上
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {assets.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-slate-400">
                      まだ固定資産が登録されていません。
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

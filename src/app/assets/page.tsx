"use client";

import { Fragment, useEffect, useState, type FormEvent } from "react";
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
  disposedAt: string | null;
  disposalPrice: number | null;
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
  const [message, setMessage] = useState<string | null>(null);
  const [disposing, setDisposing] = useState<{ id: string; date: string; price: string; receiveTo: string } | null>(null);
  const [busy, setBusy] = useState(false);

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

  async function post(url: string, body: object) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "処理に失敗しました");
      await load();
      return data;
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function depreciateAll() {
    const data = await post("/api/fixed-assets/depreciate-all", { period });
    if (data) setMessage(data.posted ? `${data.posted}件・${formatYen(data.total)}の減価償却費を計上しました` : "計上できる資産はありませんでした");
  }

  async function dispose(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!disposing) return;
    const asset = assets.find((a) => a.id === disposing.id);
    const price = Number(disposing.price || 0);
    const data = await post(`/api/fixed-assets/${disposing.id}/dispose`, { date: disposing.date, price, receiveTo: disposing.receiveTo });
    if (data) {
      setDisposing(null);
      setMessage(
        `${asset?.name}を${price > 0 ? "売却" : "除却"}しました(${data.gain > 0 ? `売却益 ${formatYen(data.gain)}` : data.gain < 0 ? `除売却損 ${formatYen(-data.gain)}` : "損益なし"})`,
      );
    }
  }

  const period = currentPeriod();
  const pending = assets.filter(
    (a) => !a.disposedAt && !a.fullyDepreciated && a.acquisitionDate.slice(0, 7) <= period && !a.depreciationEntries.some((e) => e.period === period),
  ).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">固定資産管理</h1>
        <p className="mt-1 text-sm text-slate-600">
          資産を登録すると取得の仕訳(固定資産/普通預金)が自動で記帳されます。「当月分を計上」を押すと
          定額法で計算した減価償却費(減価償却費/減価償却累計額)が記帳されます。同じ月に二重計上はできません。
          売ったり捨てたりした資産は「除却・売却」で帳簿から外します(帳簿価額との差額は売却益・除売却損になります)。
        </p>
      </div>

      {error && <div className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</div>}
      {message && <div className="rounded-md bg-emerald-50 px-4 py-2 text-sm text-emerald-800">{message}</div>}

      {pending > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm text-amber-900">
            {period} 分の減価償却がまだの資産が {pending} 件あります。
          </p>
          <button onClick={depreciateAll} disabled={busy} className="rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50">
            まとめて計上する
          </button>
        </div>
      )}

      <form onSubmit={handleRegister} className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white shadow-sm p-4">
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
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
        >
          {creating ? "登録中..." : "資産を登録"}
        </button>
      </form>

      {loading ? (
        <p className="text-sm text-slate-500">読み込み中...</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
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
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {assets.map((asset) => {
                  const alreadyPostedThisPeriod = asset.depreciationEntries.some((e) => e.period === period);
                  return (
                    <Fragment key={asset.id}>
                    <tr className={asset.disposedAt ? "text-slate-400" : ""}>
                      <td className="px-4 py-2 whitespace-nowrap">{asset.name}</td>
                      <td className="px-4 py-2 whitespace-nowrap">{formatDate(asset.acquisitionDate)}</td>
                      <td className="px-4 py-2 text-right whitespace-nowrap">{formatYen(asset.acquisitionCost)}</td>
                      <td className="px-4 py-2 text-right whitespace-nowrap">{formatYen(asset.accumulatedDepreciation)}</td>
                      <td className="px-4 py-2 text-right whitespace-nowrap font-medium">{formatYen(asset.bookValue)}</td>
                      <td className="px-4 py-2 text-right whitespace-nowrap">{formatYen(asset.monthlyDepreciation)}</td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        {asset.disposedAt ? (
                          <span className="text-xs">
                            {formatDate(asset.disposedAt)} {asset.disposalPrice ? `売却(${formatYen(asset.disposalPrice)})` : "除却"}済み
                          </span>
                        ) : asset.fullyDepreciated ? (
                          <span className="text-xs text-slate-400">償却完了</span>
                        ) : asset.acquisitionDate.slice(0, 7) > period ? (
                          <span className="text-xs text-slate-400">取得月から計上できます</span>
                        ) : alreadyPostedThisPeriod ? (
                          <span className="text-xs text-slate-400">{period} 計上済み</span>
                        ) : (
                          <button
                            onClick={() => handleDepreciate(asset.id)}
                            disabled={depreciatingId === asset.id}
                            className="rounded-md bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                          >
                            {period} 分を計上
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right whitespace-nowrap">
                        {!asset.disposedAt && (
                          <button
                            onClick={() => setDisposing(disposing?.id === asset.id ? null : { id: asset.id, date: new Date().toISOString().slice(0, 10), price: "", receiveTo: "1020" })}
                            className="text-xs text-slate-600 hover:underline"
                          >
                            除却・売却
                          </button>
                        )}
                      </td>
                    </tr>
                    {disposing?.id === asset.id && (
                      <tr className="bg-slate-50">
                        <td colSpan={8} className="px-4 py-3">
                          <form onSubmit={dispose} className="flex flex-wrap items-end gap-3">
                            <label className="text-xs text-slate-500">
                              日付
                              <input type="date" value={disposing.date} onChange={(e) => setDisposing({ ...disposing, date: e.target.value })} required className="mt-1 block rounded border bg-white px-2 py-1.5 text-sm text-slate-900" />
                            </label>
                            <label className="text-xs text-slate-500">
                              売却額(捨てる場合は0)
                              <input type="number" min={0} value={disposing.price} onChange={(e) => setDisposing({ ...disposing, price: e.target.value })} placeholder="0" className="mt-1 block w-32 rounded border bg-white px-2 py-1.5 text-sm text-slate-900" />
                            </label>
                            {Number(disposing.price) > 0 && (
                              <label className="text-xs text-slate-500">
                                入金先
                                <select value={disposing.receiveTo} onChange={(e) => setDisposing({ ...disposing, receiveTo: e.target.value })} className="mt-1 block rounded border bg-white px-2 py-1.5 text-sm text-slate-900">
                                  <option value="1020">普通預金</option>
                                  <option value="1010">現金</option>
                                </select>
                              </label>
                            )}
                            <button type="submit" disabled={busy} className="rounded-md bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50">
                              {Number(disposing.price) > 0 ? "売却する" : "除却する"}
                            </button>
                            <span className="text-xs text-slate-500">
                              帳簿価額 {formatYen(asset.bookValue)} との差額を{Number(disposing.price) > asset.bookValue ? "売却益" : "除売却損"}として記帳します。
                            </span>
                          </form>
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  );
                })}
                {assets.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-6 text-center text-slate-400">
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

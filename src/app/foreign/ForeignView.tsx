"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { formatYen } from "@/lib/format";

type Item = {
  id: string;
  kind: "SALE" | "PURCHASE";
  partner: string;
  description: string;
  currency: string;
  amount: string;
  rate: number;
  jpyAmount: number;
  accountName: string;
  date: string;
  dueDate: string | null;
  overdue: boolean;
  settledAt: string | null;
  settledJpy: number | null;
  gain: number | null;
};
type Open = { currency: string; kind: string; minor: string; amount: string; jpy: number; digits: number };
type Option = { code: string; name: string };
type Data = { items: Item[]; open: Open[]; realized: number; currencies: { code: string; name: string; digits: number }[]; revenueAccounts: Option[]; expenseAccounts: Option[]; cashAccounts: Option[] };

const slash = (d: string) => d.replaceAll("-", "/");
const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());
const input = "mt-1 w-full rounded-md border px-3 py-2 text-sm";
const signed = (n: number) => (n > 0 ? `+${formatYen(n)}` : n < 0 ? `−${formatYen(-n)}` : formatYen(0));

export function ForeignView() {
  const [data, setData] = useState<Data | null>(null);
  const [kind, setKind] = useState<"SALE" | "PURCHASE">("SALE");
  const [adding, setAdding] = useState(false);
  const [settling, setSettling] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  // 今のレートを入れると、まだ入金・支払いしていない外貨を今のレートで円にした見込みを出す(記帳はしない)
  const [nowRates, setNowRates] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const res = await fetch("/api/foreign");
    if (res.ok) setData(await res.json());
  }, []);

  useEffect(() => {
    // Fetch-on-mount: setState always lands after the fetch's await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function send(url: string, method: string, body?: object) {
    setBusy(true);
    setMessage(null);
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) setMessage({ ok: false, text: json.error || "処理できませんでした" });
    return res.ok ? json : null;
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const r = await send("/api/foreign", "POST", { ...Object.fromEntries(new FormData(event.currentTarget)), kind });
    if (!r) return;
    setAdding(false);
    setMessage({ ok: true, text: `計上しました(${formatYen(r.jpyAmount)})。` });
    await load();
  }

  async function settle(event: FormEvent<HTMLFormElement>, item: Item) {
    event.preventDefault();
    const r = await send(`/api/foreign/${item.id}`, "POST", { action: "settle", ...Object.fromEntries(new FormData(event.currentTarget)) });
    if (!r) return;
    setSettling(null);
    setMessage({ ok: true, text: `${item.kind === "SALE" ? "入金" : "支払い"}を記帳しました(${formatYen(r.jpy)}・計上時 ${formatYen(r.booked)}・為替差${r.gain >= 0 ? "益" : "損"} ${formatYen(Math.abs(r.gain))})。` });
    await load();
  }

  if (!data) return null;
  const accounts = kind === "SALE" ? data.revenueAccounts : data.expenseAccounts;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">外貨建ての取引</h1>
          <p className="mt-1 text-sm text-slate-600">
            ドル・ユーロなど外貨での売上・仕入を、計上した日のレートで円にして記帳します。入金・支払いのときに実際に動いた円との差は、為替差益・為替差損として記帳します。
          </p>
        </div>
        <button onClick={() => setAdding((v) => !v)} className="rounded-md bg-vermilion-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-vermilion-700">
          取引を追加
        </button>
      </div>

      {message && <div className={`rounded-md px-4 py-2 text-sm ${message.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"}`}>{message.text}</div>}

      {adding && (
        <form onSubmit={create} className="space-y-4 rounded-xl border border-indigo-200 bg-white p-4 shadow-sm">
          <div className="flex gap-4 text-sm">
            {(
              [
                ["SALE", "外貨の売上(売掛金)"],
                ["PURCHASE", "外貨の仕入・経費(買掛金)"],
              ] as const
            ).map(([k, l]) => (
              <label key={k} className="flex items-center gap-1">
                <input type="radio" checked={kind === k} onChange={() => setKind(k)} /> {l}
              </label>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="block text-sm">
              <span className="text-slate-600">取引先</span>
              <input name="partner" required maxLength={100} placeholder="例: ABC Trading Inc." className={input} />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">内容</span>
              <input name="description" maxLength={200} placeholder="例: 商品の輸出" className={input} />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">科目</span>
              <select name="accountCode" key={kind} defaultValue={kind === "SALE" ? "4010" : "5000"} className={input}>
                {accounts.map((a) => (
                  <option key={a.code} value={a.code}>
                    {a.code} {a.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-[7rem_1fr] gap-2 text-sm">
              <label className="block">
                <span className="text-slate-600">通貨</span>
                <select name="currency" defaultValue="USD" className={input}>
                  {data.currencies.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-slate-600">外貨の金額</span>
                <input name="amount" required inputMode="decimal" placeholder="例: 1,250.00" className={input} />
              </label>
            </div>
            <label className="block text-sm">
              <span className="text-slate-600">計上日のレート(1通貨あたりの円)</span>
              <input name="rate" required inputMode="decimal" placeholder="例: 149.85" className={input} />
              <span className="mt-1 block text-xs text-slate-500">銀行の公表する仲値(TTM)などを入れてください。</span>
            </label>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <label className="block">
                <span className="text-slate-600">計上日</span>
                <input name="date" type="date" required defaultValue={today()} className={input} />
              </label>
              <label className="block">
                <span className="text-slate-600">{kind === "SALE" ? "入金予定日" : "支払予定日"}</span>
                <input name="dueDate" type="date" className={input} />
              </label>
            </div>
          </div>
          <div className="flex gap-2">
            <button disabled={busy} className="rounded-md bg-vermilion-600 px-4 py-2 text-sm font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
              計上する
            </button>
            <button type="button" onClick={() => setAdding(false)} className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
              やめる
            </button>
          </div>
        </form>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
          <h2 className="font-semibold">まだ入金・支払いしていない外貨</h2>
          {data.open.length ? (
            <ul className="mt-2 space-y-2">
              {data.open.map((o) => {
                const key = `${o.kind}|${o.currency}`;
                const rate = Number(nowRates[o.currency]);
                const now = rate > 0 ? Math.round((Number(o.minor) / 10 ** o.digits) * rate) : null;
                const diff = now == null ? null : o.kind === "SALE" ? now - o.jpy : o.jpy - now;
                return (
                  <li key={key} className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      {o.kind === "SALE" ? "売掛金" : "買掛金"} {o.amount}
                      <span className="block text-xs text-slate-500">計上時の円 {formatYen(o.jpy)}</span>
                    </span>
                    <span className="flex items-center gap-1 text-xs text-slate-500">
                      今のレート
                      <input value={nowRates[o.currency] ?? ""} onChange={(e) => setNowRates((r) => ({ ...r, [o.currency]: e.target.value }))} inputMode="decimal" className="w-20 rounded border px-1 py-0.5 text-right" />
                      {diff != null && <span className={diff >= 0 ? "text-emerald-700" : "text-rose-700"}>見込み {signed(diff)}</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-2 text-slate-400">ありません</p>
          )}
        </section>
        <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
          <h2 className="font-semibold">これまでの為替差損益</h2>
          <p className={`mt-2 text-2xl font-semibold tabular-nums ${data.realized >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{signed(data.realized)}</p>
          <p className="text-xs text-slate-500">入金・支払いが済んだ取引の合計(プラスは為替差益)。損益計算書では営業外の収益・費用に入ります。</p>
        </section>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs whitespace-nowrap text-slate-500">
              <tr>
                <th className="px-3 py-2">計上日</th>
                <th className="px-3 py-2">取引先・内容</th>
                <th className="px-3 py-2 text-right">外貨</th>
                <th className="px-3 py-2 text-right">レート・円</th>
                <th className="px-3 py-2">入金・支払い</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.items.map((t) => (
                <tr key={t.id} className="align-top">
                  <td className="px-3 py-2 whitespace-nowrap">
                    {slash(t.date)}
                    <span className={`mt-0.5 block w-fit rounded px-1.5 text-xs ${t.kind === "SALE" ? "bg-sky-50 text-sky-800" : "bg-orange-50 text-orange-800"}`}>{t.kind === "SALE" ? "売上" : "仕入・経費"}</span>
                  </td>
                  <td className="min-w-[10rem] px-3 py-2">
                    <span className="font-medium">{t.partner}</span>
                    <span className="block text-xs text-slate-500">
                      {t.description}・{t.accountName}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">{t.amount}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
                    @{t.rate}
                    <span className="block">{formatYen(t.jpyAmount)}</span>
                  </td>
                  <td className="min-w-[12rem] px-3 py-2">
                    {t.settledAt ? (
                      <>
                        {slash(t.settledAt)} {formatYen(t.settledJpy ?? 0)}
                        <span className={`block text-xs ${(t.gain ?? 0) >= 0 ? "text-emerald-700" : "text-rose-700"}`}>為替差{(t.gain ?? 0) >= 0 ? "益" : "損"} {formatYen(Math.abs(t.gain ?? 0))}</span>
                      </>
                    ) : settling === t.id ? (
                      <form onSubmit={(e) => settle(e, t)} className="space-y-1 text-xs">
                        <input name="date" type="date" required defaultValue={today()} className="w-full rounded border px-2 py-1" />
                        <input name="jpy" inputMode="numeric" placeholder={t.kind === "SALE" ? "入金された円" : "支払った円"} className="w-full rounded border px-2 py-1" />
                        <input name="rate" inputMode="decimal" placeholder="または その日のレート" className="w-full rounded border px-2 py-1" />
                        <select name="cashCode" defaultValue="1020" className="w-full rounded border px-2 py-1">
                          {data.cashAccounts.map((a) => (
                            <option key={a.code} value={a.code}>
                              {a.name}
                            </option>
                          ))}
                        </select>
                        <div className="flex gap-2">
                          <button disabled={busy} className="rounded bg-indigo-600 px-2 py-1 font-medium text-white disabled:opacity-50">
                            記帳する
                          </button>
                          <button type="button" onClick={() => setSettling(null)} className="text-slate-500">
                            やめる
                          </button>
                        </div>
                      </form>
                    ) : (
                      <span className={t.overdue ? "text-rose-700" : "text-slate-500"}>
                        未{t.kind === "SALE" ? "入金" : "払い"}
                        {t.dueDate && `(予定 ${slash(t.dueDate)}${t.overdue ? "・過ぎています" : ""})`}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <div className="flex justify-end gap-3 text-xs">
                      {t.settledAt ? (
                        <button onClick={() => confirm("入金・支払いの記帳を取り消しますか?") && send(`/api/foreign/${t.id}`, "POST", { action: "unsettle" }).then((r) => r && load())} className="text-slate-500 hover:underline">
                          入金・支払いを取消
                        </button>
                      ) : (
                        <>
                          <button onClick={() => setSettling(t.id)} className="text-indigo-700 hover:underline">
                            {t.kind === "SALE" ? "入金" : "支払い"}
                          </button>
                          <button onClick={() => confirm(`「${t.partner}」の取引を取り消しますか?(計上の仕訳を取消にします)`) && send(`/api/foreign/${t.id}`, "DELETE").then((r) => r && load())} className="text-slate-500 hover:text-rose-700 hover:underline">
                            取消
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {data.items.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-slate-400">
                    まだ外貨建ての取引はありません。「取引を追加」から計上してください。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-slate-500">
        決算のときに、まだ入金・支払いしていない外貨の売掛金・買掛金を期末のレートで評価し直すかどうかは、税理士さんにご相談ください(上の「今のレート」で差額の見込みを確かめられます)。
      </p>
    </div>
  );
}

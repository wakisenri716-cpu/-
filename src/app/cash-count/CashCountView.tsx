"use client";

import { useCallback, useEffect, useState } from "react";
import { formatYen } from "@/lib/format";

type Count = { id: string; date: string; counts: Record<string, number>; counted: number; book: number; diff: number; note: string | null; countedByName: string; adjusted: boolean };
type Data = { today: string; book: number; denominations: number[]; counts: Count[] };

const label = (d: number) => (d >= 1000 ? `${d.toLocaleString()}円札` : `${d}円玉`);
const slash = (d: string) => d.replaceAll("-", "/");
const signed = (n: number) => (n > 0 ? `+${formatYen(n)}` : n < 0 ? `−${formatYen(-n)}` : "ぴったり");

export function CashCountView() {
  const [data, setData] = useState<Data | null>(null);
  const [date, setDate] = useState("");
  const [book, setBook] = useState<number | null>(null);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/cash-counts");
    if (!res.ok) return;
    const d: Data = await res.json();
    setData(d);
    setDate((cur) => cur || d.today);
    setBook((cur) => cur ?? d.book);
  }, []);

  useEffect(() => {
    // Fetch-on-mount: setState always lands after the fetch's await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function changeDate(value: string) {
    setDate(value);
    if (!value) return;
    const res = await fetch(`/api/cash-counts?date=${value}`);
    if (res.ok) setBook((await res.json()).book);
  }

  async function save(adjust: boolean) {
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/cash-counts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date, counts, note, adjust }) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setMessage({ ok: false, text: json.error || "記録できませんでした" });
    setMessage({
      ok: true,
      text:
        json.diff === 0
          ? "記録しました。帳簿の現金とぴったり合っています。"
          : json.adjusted
            ? `記録して、差額 ${formatYen(Math.abs(json.diff))} を${json.diff > 0 ? "雑収入" : "雑損失"}で合わせました。`
            : `記録しました(差額 ${signed(json.diff)} はそのままです)。`,
    });
    setCounts({});
    setNote("");
    setBook(null);
    await load();
  }

  async function remove(c: Count) {
    if (!confirm(`${slash(c.date)}の記録を削除しますか?${c.adjusted ? "(合わせた仕訳も取消にします)" : ""}`)) return;
    const res = await fetch(`/api/cash-counts/${c.id}`, { method: "DELETE" });
    if (res.ok) await load();
  }

  if (!data) return null;
  const total = data.denominations.reduce((s, d) => s + d * (Number(counts[String(d)]) || 0), 0);
  const entered = Object.values(counts).some((v) => v !== "");
  // 枚数を入れるまでは差額を出さない
  const diff = book == null || !entered ? null : total - book;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">現金の実査(金種表)</h1>
        <p className="mt-1 text-sm text-slate-600">
          レジや金庫のお札・硬貨の枚数を入れると、実際の現金を計算して、帳簿の「現金」の残高と比べます。差があるときは、多ければ雑収入、足りなければ雑損失の仕訳で帳簿を実際に合わせられます。
        </p>
      </div>

      {message && <div className={`rounded-md px-4 py-2 text-sm ${message.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"}`}>{message.text}</div>}

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <label className="mb-3 flex items-center gap-2 text-sm">
            <span className="text-slate-600">数えた日</span>
            <input type="date" value={date} max={data.today} onChange={(e) => changeDate(e.target.value)} className="rounded-md border px-2 py-1" />
          </label>
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-500">
              <tr>
                <th className="py-1 text-left font-medium">金種</th>
                <th className="py-1 text-right font-medium">枚数</th>
                <th className="py-1 text-right font-medium">金額</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.denominations.map((d) => {
                const n = Number(counts[String(d)]) || 0;
                return (
                  <tr key={d}>
                    <td className="py-1.5">{label(d)}</td>
                    <td className="py-1.5 text-right">
                      <input
                        value={counts[String(d)] ?? ""}
                        onChange={(e) => setCounts((c) => ({ ...c, [String(d)]: e.target.value }))}
                        inputMode="numeric"
                        placeholder="0"
                        aria-label={`${label(d)}の枚数`}
                        className="w-24 rounded-md border px-2 py-1 text-right tabular-nums"
                      />
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{n ? formatYen(d * n) : "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
          <p>
            実際の現金
            <span className="block text-2xl font-semibold tabular-nums">{formatYen(total)}</span>
          </p>
          <p>
            帳簿の現金({date ? slash(date) : ""}時点)
            <span className="block text-lg tabular-nums">{book == null ? "…" : formatYen(book)}</span>
          </p>
          <p>
            差額
            <span className={`block text-lg font-semibold tabular-nums ${diff === 0 ? "text-emerald-700" : diff == null ? "" : diff > 0 ? "text-sky-700" : "text-rose-700"}`}>
              {diff == null ? "…" : diff === 0 ? "ぴったり" : `${signed(diff)}(${diff > 0 ? "多い" : "足りない"})`}
            </span>
          </p>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="メモ(例: 本店レジ・閉店後)" className="w-full rounded-md border px-3 py-2" />
          <div className="space-y-2">
            {diff !== null && diff !== 0 && (
              <button disabled={busy || !entered} onClick={() => save(true)} className="w-full rounded-md bg-vermilion-600 px-4 py-2 font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
                記録して帳簿を合わせる({diff > 0 ? "雑収入" : "雑損失"} {formatYen(Math.abs(diff))})
              </button>
            )}
            <button disabled={busy || !entered} onClick={() => save(false)} className={`w-full rounded-md px-4 py-2 font-medium disabled:opacity-50 ${diff === 0 ? "bg-vermilion-600 text-white hover:bg-vermilion-700" : "border border-slate-300 text-slate-700 hover:bg-slate-50"}`}>
              {diff === 0 ? "記録する" : "記録だけする(帳簿は合わせない)"}
            </button>
          </div>
          <p className="text-xs text-slate-500">原因(つり銭の間違い・記帳もれなど)がわかったときは、合わせずに正しい仕訳を入れてください。</p>
        </section>
      </div>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <h2 className="border-b px-4 py-2 text-sm font-semibold">これまでの記録</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs whitespace-nowrap text-slate-500">
              <tr>
                <th className="px-3 py-2">日付</th>
                <th className="px-3 py-2 text-right">実際</th>
                <th className="px-3 py-2 text-right">帳簿</th>
                <th className="px-3 py-2 text-right">差額</th>
                <th className="px-3 py-2">メモ・数えた人</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.counts.map((c) => (
                <tr key={c.id}>
                  <td className="px-3 py-2 whitespace-nowrap">{slash(c.date)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatYen(c.counted)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatYen(c.book)}</td>
                  <td className={`px-3 py-2 text-right whitespace-nowrap tabular-nums ${c.diff === 0 ? "text-emerald-700" : c.diff > 0 ? "text-sky-700" : "text-rose-700"}`}>
                    {signed(c.diff)}
                    {c.diff !== 0 && <span className="block text-xs text-slate-500">{c.adjusted ? "帳簿を合わせた" : "合わせていない"}</span>}
                  </td>
                  <td className="min-w-[10rem] px-3 py-2 text-xs text-slate-600">
                    {c.note}
                    <span className="block text-slate-400">{c.countedByName}</span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => remove(c)} className="text-xs text-slate-500 hover:text-rose-700 hover:underline">
                      削除
                    </button>
                  </td>
                </tr>
              ))}
              {data.counts.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                    まだ記録はありません。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

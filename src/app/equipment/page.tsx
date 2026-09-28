"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { formatYen } from "@/lib/format";

type Status = "ACTIVE" | "BROKEN" | "DISPOSED";
type Loan = { id: string; borrowerName: string; lentAt: string; dueDate: string | null; returnedAt: string | null; notes: string | null };
type Item = {
  id: string;
  code: string | null;
  name: string;
  category: string | null;
  serialNumber: string | null;
  location: string | null;
  purchaseDate: string | null;
  price: number | null;
  status: Status;
  notes: string | null;
  loan: { borrowerName: string; lentAt: string; dueDate: string | null; overdue: boolean } | null;
  history: Loan[];
};
type Data = {
  members: { id: string; name: string }[];
  categories: string[];
  items: Item[];
  summary: { total: number; lent: number; overdue: number; value: number };
};
type Filter = "all" | "lent" | "overdue" | "free" | "inactive";
type Modal = { kind: "edit"; item: Item | null } | { kind: "lend"; item: Item } | { kind: "return"; item: Item } | { kind: "history"; item: Item };

const STATUS_LABEL: Record<Status, string> = { ACTIVE: "使用中", BROKEN: "故障", DISPOSED: "廃棄" };
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "すべて" },
  { key: "lent", label: "貸出中" },
  { key: "overdue", label: "返却予定を過ぎた" },
  { key: "free", label: "空いている" },
  { key: "inactive", label: "故障・廃棄" },
];
const inputClass = "mt-1 w-full rounded-md border px-3 py-2 text-sm";
// 今年の日付は「月/日」、ほかの年は「年/月/日」
const md = (d: string | null) =>
  d ? `${d.slice(0, 4) === String(new Date().getFullYear()) ? "" : `${d.slice(0, 4)}/`}${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : "";
const ymd = (d: string | null) => (d ? d.replaceAll("-", "/") : "");
const todayKey = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());

function matches(item: Item, filter: Filter) {
  if (filter === "lent") return !!item.loan;
  if (filter === "overdue") return !!item.loan?.overdue;
  if (filter === "free") return item.status === "ACTIVE" && !item.loan;
  if (filter === "inactive") return item.status !== "ACTIVE";
  return true;
}

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={`block text-sm ${wide ? "sm:col-span-2" : ""}`}>
      <span className="text-slate-600">{label}</span>
      {children}
    </label>
  );
}

export default function EquipmentPage() {
  const [data, setData] = useState<Data | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [category, setCategory] = useState("");
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState<Modal | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/equipment");
    if (res.ok) setData(await res.json());
  }, []);

  useEffect(() => {
    // Fetch-on-mount: setState always lands after the fetch's await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function call(url: string, method: string, body: object | undefined, done: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(json.error || "処理できませんでした");
      return false;
    }
    setMessage(done);
    setModal(null);
    await load();
    return true;
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!modal) return;
    const body = Object.fromEntries(new FormData(event.currentTarget));
    if (modal.kind === "edit") {
      if (modal.item) call(`/api/equipment/${modal.item.id}`, "PATCH", body, "備品を保存しました");
      else call("/api/equipment", "POST", body, "備品を登録しました");
    } else if (modal.kind === "lend") {
      call(`/api/equipment/${modal.item.id}`, "POST", { ...body, action: "lend" }, `「${modal.item.name}」を貸し出しました`);
    } else if (modal.kind === "return") {
      call(`/api/equipment/${modal.item.id}`, "POST", { ...body, action: "return" }, `「${modal.item.name}」の返却を記録しました`);
    }
  }

  function remove(item: Item) {
    if (!confirm(`「${item.name}」を削除しますか?`)) return;
    call(`/api/equipment/${item.id}`, "DELETE", undefined, "備品を削除しました");
  }

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.items ?? []).filter(
      (item) =>
        matches(item, filter) &&
        (!category || item.category === category) &&
        (!q || [item.code, item.name, item.serialNumber, item.location, item.loan?.borrowerName].some((v) => v?.toLowerCase().includes(q))),
    );
  }, [data, filter, category, query]);

  const s = data?.summary;
  const today = todayKey();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-2xl font-semibold">備品管理</h1>
          <p className="mt-1 text-sm text-slate-600">
            パソコン・スマホ・鍵など、会社の備品の台帳です。誰に貸しているか、いつ返してもらうかを記録します。借りている人は「アカウント」の画面で自分の分を確かめられます。
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => window.print()} className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50">
            台帳を印刷
          </button>
          <button onClick={() => setModal({ kind: "edit", item: null })} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700">
            + 備品を登録
          </button>
        </div>
      </div>

      {error && <div className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-700 print:hidden">{error}</div>}
      {message && <div className="rounded-md bg-emerald-50 px-4 py-2 text-sm text-emerald-800 print:hidden">{message}</div>}

      {s && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 print:hidden">
          {[
            { label: "使用中の備品", value: `${s.total}点` },
            { label: "貸出中", value: `${s.lent}点` },
            { label: "返却予定を過ぎた", value: `${s.overdue}点`, alert: s.overdue > 0 },
            { label: "購入金額の合計", value: formatYen(s.value) },
          ].map((t) => (
            <div key={t.label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs text-slate-500">{t.label}</p>
              <p className={`mt-1 text-xl font-semibold tabular-nums ${t.alert ? "text-rose-700" : ""}`}>{t.value}</p>
            </div>
          ))}
        </div>
      )}

      {data && (
        <div className="space-y-3 print:hidden">
          <div className="flex flex-wrap items-center gap-2">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`rounded-full border px-3 py-1 text-sm ${filter === f.key ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
              >
                {f.label}
                <span className="ml-1 text-xs opacity-75">{data.items.filter((i) => matches(i, f.key)).length}</span>
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-md border px-3 py-2 text-sm" aria-label="種類">
              <option value="">すべての種類</option>
              {data.categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="管理番号・名前・借りている人で探す"
              className="min-w-0 flex-1 rounded-md border px-3 py-2 text-sm sm:max-w-xs"
            />
          </div>

          <ul className="space-y-2">
            {rows.map((item) => (
              <li key={item.id} className={`rounded-xl border bg-white p-4 shadow-sm ${item.loan?.overdue ? "border-rose-300" : "border-slate-200"} ${item.status === "DISPOSED" ? "opacity-60" : ""}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {item.code && <span className="mr-2 text-xs font-normal text-slate-400">{item.code}</span>}
                      {item.name}
                      {item.status !== "ACTIVE" && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-normal text-slate-600">{STATUS_LABEL[item.status]}</span>}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {[item.category, item.location && `保管: ${item.location}`, item.serialNumber && `製造番号 ${item.serialNumber}`, item.price !== null && formatYen(item.price), item.purchaseDate && `${ymd(item.purchaseDate)}購入`]
                        .filter(Boolean)
                        .join(" / ")}
                    </p>
                  </div>
                  <div className="text-sm sm:text-right">
                    {item.loan ? (
                      <p>
                        <span className="text-slate-500">貸出中: </span>
                        <span className="font-medium">{item.loan.borrowerName}</span>
                        <span className={`block text-xs ${item.loan.overdue ? "font-medium text-rose-700" : "text-slate-500"}`}>
                          {md(item.loan.lentAt)}から{item.loan.dueDate && ` / ${md(item.loan.dueDate)}返却予定`}
                          {item.loan.overdue && "(過ぎています)"}
                        </span>
                      </p>
                    ) : (
                      item.status === "ACTIVE" && <p className="text-xs text-emerald-700">空いています</p>
                    )}
                  </div>
                </div>
                {item.notes && <p className="mt-1 text-xs whitespace-pre-wrap text-slate-600">{item.notes}</p>}
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 border-t pt-2 text-sm">
                  {item.loan ? (
                    <button onClick={() => setModal({ kind: "return", item })} disabled={busy} className="font-medium text-indigo-700 hover:underline">
                      返却を記録
                    </button>
                  ) : (
                    item.status === "ACTIVE" && (
                      <button onClick={() => setModal({ kind: "lend", item })} disabled={busy} className="font-medium text-indigo-700 hover:underline">
                        貸し出す
                      </button>
                    )
                  )}
                  <button onClick={() => setModal({ kind: "edit", item })} className="text-slate-600 hover:underline">
                    編集
                  </button>
                  {item.history.length > 0 && (
                    <button onClick={() => setModal({ kind: "history", item })} className="text-slate-600 hover:underline">
                      貸出の履歴({item.history.length})
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {rows.length === 0 && (
            <p className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
              {data.items.length ? "条件に合う備品はありません" : "まだ備品がありません。「+ 備品を登録」から、パソコンや鍵などを登録してください。"}
            </p>
          )}
        </div>
      )}

      {/* 印刷用の台帳 */}
      {data && (
        <div className="hidden print:block">
          <h1 className="mb-1 text-xl font-semibold">備品台帳</h1>
          <p className="mb-3 text-xs">{ymd(today)} 現在 / 使用中 {data.summary.total}点・貸出中 {data.summary.lent}点</p>
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr>
                {["管理番号", "備品名", "種類", "製造番号", "保管場所", "購入日", "購入金額", "状態", "貸出先", "返却予定"].map((h) => (
                  <th key={h} className="border border-slate-400 px-1 py-0.5 text-left">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => (
                <tr key={item.id}>
                  <td className="border border-slate-400 px-1 py-0.5">{item.code}</td>
                  <td className="border border-slate-400 px-1 py-0.5">{item.name}</td>
                  <td className="border border-slate-400 px-1 py-0.5">{item.category}</td>
                  <td className="border border-slate-400 px-1 py-0.5">{item.serialNumber}</td>
                  <td className="border border-slate-400 px-1 py-0.5">{item.location}</td>
                  <td className="border border-slate-400 px-1 py-0.5">{ymd(item.purchaseDate)}</td>
                  <td className="border border-slate-400 px-1 py-0.5 text-right">{item.price !== null ? formatYen(item.price) : ""}</td>
                  <td className="border border-slate-400 px-1 py-0.5">{STATUS_LABEL[item.status]}</td>
                  <td className="border border-slate-400 px-1 py-0.5">{item.loan ? `${item.loan.borrowerName}(${ymd(item.loan.lentAt)}〜)` : ""}</td>
                  <td className="border border-slate-400 px-1 py-0.5">{ymd(item.loan?.dueDate ?? null)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && data && (
        <div className="fixed inset-0 z-20 flex items-end justify-center bg-slate-900/30 p-4 sm:items-center print:hidden" onClick={() => setModal(null)}>
          <div onClick={(e) => e.stopPropagation()} className="max-h-[90vh] w-full max-w-xl space-y-3 overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
            {modal.kind === "edit" && (
              <>
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold">{modal.item ? "備品を編集" : "備品を登録"}</h2>
                  {modal.item && modal.item.history.length === 0 && (
                    <button onClick={() => remove(modal.item!)} disabled={busy} className="text-xs text-slate-500 hover:text-rose-700 hover:underline">
                      削除
                    </button>
                  )}
                </div>
                <form onSubmit={submit} className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="備品名">
                      <input name="name" required maxLength={60} defaultValue={modal.item?.name} placeholder="例: ノートパソコン" className={inputClass} />
                    </Field>
                    <Field label="管理番号(任意)">
                      <input name="code" maxLength={30} defaultValue={modal.item?.code ?? ""} placeholder="例: PC-001" className={inputClass} />
                    </Field>
                    <Field label="種類(任意)">
                      <input name="category" list="equipment-categories" maxLength={30} defaultValue={modal.item?.category ?? ""} placeholder="例: パソコン" className={inputClass} />
                      <datalist id="equipment-categories">
                        {[...new Set([...data.categories, "パソコン", "スマホ", "鍵", "モニター", "車両"])].map((c) => (
                          <option key={c} value={c} />
                        ))}
                      </datalist>
                    </Field>
                    <Field label="製造番号(任意)">
                      <input name="serialNumber" maxLength={60} defaultValue={modal.item?.serialNumber ?? ""} className={inputClass} />
                    </Field>
                    <Field label="保管場所(任意)">
                      <input name="location" maxLength={60} defaultValue={modal.item?.location ?? ""} placeholder="例: 本社 キャビネットA" className={inputClass} />
                    </Field>
                    <Field label="状態">
                      <select name="status" defaultValue={modal.item?.status ?? "ACTIVE"} className={inputClass}>
                        {(Object.keys(STATUS_LABEL) as Status[]).map((k) => (
                          <option key={k} value={k}>
                            {STATUS_LABEL[k]}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="購入日(任意)">
                      <input name="purchaseDate" type="date" defaultValue={modal.item?.purchaseDate ?? ""} className={inputClass} />
                    </Field>
                    <Field label="購入金額(円・任意)">
                      <input name="price" inputMode="numeric" defaultValue={modal.item?.price ?? ""} className={inputClass} />
                    </Field>
                    <Field label="メモ(任意)" wide>
                      <textarea name="notes" rows={2} maxLength={500} defaultValue={modal.item?.notes ?? ""} className={inputClass} />
                    </Field>
                  </div>
                  <p className="text-xs text-slate-500">10万円以上のものは、会計上は「固定資産」にも登録してください(減価償却のため)。</p>
                  <Buttons busy={busy} label={modal.item ? "保存" : "登録"} onCancel={() => setModal(null)} />
                </form>
              </>
            )}

            {modal.kind === "lend" && (
              <>
                <h2 className="font-semibold">「{modal.item.name}」を貸し出す</h2>
                <form onSubmit={submit} className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="借りる人(メンバー)">
                      <select name="userId" defaultValue="" className={inputClass}>
                        <option value="">(メンバー以外 → 右に名前)</option>
                        {data.members.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="メンバー以外の人の名前">
                      <input name="borrowerName" maxLength={40} placeholder="例: 外注 佐藤さん" className={inputClass} />
                    </Field>
                    <Field label="貸出日">
                      <input name="lentAt" type="date" required defaultValue={today} className={inputClass} />
                    </Field>
                    <Field label="返却予定日(任意)">
                      <input name="dueDate" type="date" className={inputClass} />
                    </Field>
                    <Field label="メモ(任意)" wide>
                      <input name="notes" maxLength={200} placeholder="例: 充電器も一緒に" className={inputClass} />
                    </Field>
                  </div>
                  <p className="text-xs text-slate-500">メンバーに貸すと、その人の「アカウント」画面に借りている備品として出ます。</p>
                  <Buttons busy={busy} label="貸し出す" onCancel={() => setModal(null)} />
                </form>
              </>
            )}

            {modal.kind === "return" && modal.item.loan && (
              <>
                <h2 className="font-semibold">「{modal.item.name}」の返却を記録</h2>
                <p className="text-sm text-slate-600">
                  貸出中: {modal.item.loan.borrowerName}({ymd(modal.item.loan.lentAt)}から)
                </p>
                <form onSubmit={submit} className="space-y-3">
                  <Field label="返却日">
                    <input name="returnedAt" type="date" required defaultValue={today} className={inputClass} />
                  </Field>
                  <Buttons busy={busy} label="返却を記録" onCancel={() => setModal(null)} />
                </form>
              </>
            )}

            {modal.kind === "history" && (
              <>
                <h2 className="font-semibold">「{modal.item.name}」の貸出の履歴</h2>
                <ul className="divide-y divide-slate-100 text-sm">
                  {modal.item.history.map((l) => (
                    <li key={l.id} className="py-2">
                      <p>
                        <span className="font-medium">{l.borrowerName}</span>
                        <span className="ml-2 text-slate-600">
                          {ymd(l.lentAt)} 〜 {l.returnedAt ? ymd(l.returnedAt) : <span className="text-indigo-700">貸出中</span>}
                        </span>
                      </p>
                      {(l.dueDate || l.notes) && (
                        <p className="text-xs text-slate-500">{[l.dueDate && `返却予定 ${ymd(l.dueDate)}`, l.notes].filter(Boolean).join(" / ")}</p>
                      )}
                    </li>
                  ))}
                </ul>
                <div className="text-right">
                  <button onClick={() => setModal(null)} className="rounded-md border px-4 py-2 text-sm">
                    閉じる
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Buttons({ busy, label, onCancel }: { busy: boolean; label: string; onCancel: () => void }) {
  return (
    <div className="flex justify-end gap-2">
      <button type="button" onClick={onCancel} className="rounded-md border px-4 py-2 text-sm">
        やめる
      </button>
      <button type="submit" disabled={busy} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50">
        {busy ? "処理中..." : label}
      </button>
    </div>
  );
}

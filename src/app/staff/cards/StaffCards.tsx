"use client";

import { useEffect, useState } from "react";

type Form = { userName: string; nameKana: string | null; nameEn: string | null; title: string | null; titleEn: string | null; department: string | null; email: string | null; phone: string | null; mobile: string | null; quantity: number; note?: string | null };
type Order = { id: string; quantity: number; status: string; createdAt: string; title: string | null };
const STATUS: Record<string, string> = { REQUESTED: "申し込み中", ORDERED: "印刷を頼みました", DELIVERED: "届きました", CANCELLED: "取り消し" };
const input = "w-full rounded-xl border border-slate-300 px-3 py-2 text-sm";

export function StaffCards() {
  const [form, setForm] = useState<Form | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = () =>
    fetch("/api/staff-app/cards")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setForm(d.defaults);
        setOrders(d.orders);
      })
      .catch(() => {});
  useEffect(() => {
    load();
  }, []);
  async function call(key: string, url: string, method: string, body?: unknown) {
    setBusy(key);
    setMsg(null);
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) {
      setMsg({ ok: false, text: json.error || "うまくいきませんでした" });
      return null;
    }
    return json;
  }
  if (!form) return <p className="text-sm text-slate-500">読み込んでいます…</p>;
  const f = (k: keyof Form, label: string, placeholder = "") => (
    <label className="block text-xs text-slate-600">
      {label}
      <input aria-label={label} value={(form[k] as string | null) ?? ""} placeholder={placeholder} onChange={(e) => setForm({ ...form, [k]: e.target.value || null })} className={input} />
    </label>
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">名刺の注文</h1>
        <p className="mt-1 text-sm text-slate-600">前に頼んだときの中身を入れてあります。変わったところだけ直して申し込んでください。総務がまとめて印刷会社に頼み、届いたらメールで知らせます。</p>
      </div>
      <section className="space-y-2 rounded-2xl bg-white p-4 text-sm shadow-sm ring-1 ring-slate-200">
        {f("userName", "名前")}
        {f("nameKana", "ふりがな", "やまだ たろう")}
        <div className="grid grid-cols-2 gap-2">
          {f("title", "役職")}
          {f("department", "部署")}
        </div>
        {f("email", "メール")}
        <div className="grid grid-cols-2 gap-2">
          {f("phone", "電話")}
          {f("mobile", "携帯")}
        </div>
        <div className="space-y-2 rounded-xl bg-slate-50 p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-700">裏面の英語</span>
            <button
              onClick={async () => {
                const r = await call("en", "/api/staff-app/cards", "POST", { action: "english", nameKana: form.nameKana, title: form.title, department: form.department, useAi: true });
                if (r) setForm({ ...form, nameEn: r.nameEn ?? form.nameEn, titleEn: r.titleEn ?? form.titleEn });
              }}
              disabled={!!busy}
              className="rounded-lg border border-indigo-300 bg-indigo-50 px-2.5 py-1 text-xs text-indigo-800 disabled:opacity-50"
            >
              {busy === "en" ? "考えています…" : "ふりがな・役職から作る"}
            </button>
          </div>
          {f("nameEn", "英語の名前", "Taro Yamada")}
          {f("titleEn", "英語の役職", "Sales Manager")}
        </div>
        <label className="block text-xs text-slate-600">
          枚数
          <select aria-label="枚数" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })} className={input}>
            {[50, 100, 200, 300, 500].map((n) => (
              <option key={n} value={n}>
                {n}枚
              </option>
            ))}
          </select>
        </label>
        {f("note", "総務へのひとこと(任意)")}
        <button
          onClick={async () => {
            if (await call("save", "/api/staff-app/cards", "POST", form)) {
              setMsg({ ok: true, text: "申し込みました" });
              load();
            }
          }}
          disabled={!!busy}
          className="w-full rounded-xl bg-vermilion-600 px-3 py-2.5 font-semibold text-white disabled:opacity-50"
        >
          申し込む
        </button>
      </section>
      {msg && <p className={`rounded-xl px-3 py-2 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}>{msg.text}</p>}
      {orders.length > 0 && (
        <ul className="space-y-2">
          {orders.map((o) => (
            <li key={o.id} className="flex items-center gap-2 rounded-2xl bg-white p-3 text-sm shadow-sm ring-1 ring-slate-200">
              <span>{new Date(o.createdAt).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" })}</span>
              <span>{o.quantity}枚</span>
              <span className="text-xs text-slate-600">{STATUS[o.status] ?? o.status}</span>
              {o.status === "REQUESTED" && (
                <button
                  onClick={async () => {
                    if (await call(o.id, `/api/staff-app/cards/${o.id}`, "DELETE")) load();
                  }}
                  className="ml-auto text-xs text-slate-400 underline"
                >
                  取り消す
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

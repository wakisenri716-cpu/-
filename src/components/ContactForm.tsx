"use client";

import { useState, type FormEvent } from "react";

export type ContactValues = {
  postalCode: string | null;
  address: string | null;
  department: string | null;
  contactName: string | null;
  honorific: string | null;
  phone: string | null;
};

const inputClass = "mt-1 w-full rounded-md border px-3 py-2 text-sm";

// 顧客・取引先の住所と宛名の入力欄(保存すると onSaved を呼ぶ)
export function ContactForm({ kind, id, values, onSaved, onCancel }: { kind: "customer" | "vendor"; id: string; values: ContactValues; onSaved?: () => void; onCancel?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const res = await fetch(`/api/address-book/${kind}/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setMessage({ ok: false, text: json.error || "保存できませんでした" });
    setMessage({ ok: true, text: "住所・宛名を保存しました" });
    onSaved?.();
  }

  return (
    <form onSubmit={save} className="space-y-3">
      {message && <div className={`rounded-md px-3 py-2 text-sm ${message.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"}`}>{message.text}</div>}
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
        <label className="block text-sm">
          <span className="text-slate-600">郵便番号</span>
          <input name="postalCode" maxLength={10} defaultValue={values.postalCode ?? ""} placeholder="100-0001" inputMode="numeric" className={inputClass} />
        </label>
        <label className="block text-sm">
          <span className="text-slate-600">住所</span>
          <input name="address" maxLength={200} defaultValue={values.address ?? ""} placeholder="東京都千代田区千代田1-1 ○○ビル5F" className={inputClass} />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-sm">
          <span className="text-slate-600">部署</span>
          <input name="department" maxLength={60} defaultValue={values.department ?? ""} placeholder="経理部" className={inputClass} />
        </label>
        <label className="block text-sm">
          <span className="text-slate-600">担当者</span>
          <input name="contactName" maxLength={60} defaultValue={values.contactName ?? ""} placeholder="田中 一郎" className={inputClass} />
        </label>
        <label className="block text-sm">
          <span className="text-slate-600">敬称</span>
          <select name="honorific" defaultValue={values.honorific ?? ""} className={inputClass}>
            <option value="">おまかせ(担当者がいれば「様」、いなければ「御中」)</option>
            <option value="御中">御中</option>
            <option value="様">様</option>
          </select>
        </label>
      </div>
      <label className="block text-sm sm:w-1/3">
        <span className="text-slate-600">電話番号</span>
        <input name="phone" type="tel" maxLength={30} defaultValue={values.phone ?? ""} className={inputClass} />
      </label>
      <div className="flex gap-2">
        <button disabled={busy} className="rounded-md bg-vermilion-600 px-4 py-2 text-sm font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
          保存
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="rounded-md border px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
            閉じる
          </button>
        )}
      </div>
    </form>
  );
}

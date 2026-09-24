"use client";

import { useEffect, useState, type FormEvent } from "react";

type Info = { name: string; registrationNumber: string; address: string; phone: string; bankAccount: string; invoiceNote: string };

const EMPTY: Info = { name: "", registrationNumber: "", address: "", phone: "", bankAccount: "", invoiceNote: "" };

const FIELDS: { key: keyof Info; label: string; hint?: string; placeholder?: string; multiline?: boolean }[] = [
  { key: "name", label: "会社名・屋号" },
  {
    key: "registrationNumber",
    label: "適格請求書発行事業者の登録番号",
    hint: "インボイス制度の登録番号です。登録していない場合は空欄のままで構いません。",
    placeholder: "T1234567890123",
  },
  { key: "address", label: "住所", placeholder: "〒100-0001 東京都千代田区…" },
  { key: "phone", label: "電話番号", placeholder: "03-1234-5678" },
  { key: "bankAccount", label: "お振込先", placeholder: "〇〇銀行 本店 普通 1234567 カ)〇〇", multiline: true },
  { key: "invoiceNote", label: "請求書に毎回入れる備考", placeholder: "恐れ入りますが振込手数料はご負担ください。", multiline: true },
];

const inputClass = "w-full rounded-md border px-3 py-2 text-sm";

export function CompanyForm() {
  const [info, setInfo] = useState<Info | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/company").then(async (res) => {
      const body = res.ok ? await res.json() : null;
      setInfo(Object.fromEntries(Object.keys(EMPTY).map((k) => [k, body?.[k] ?? ""])) as Info);
    });
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    const res = await fetch("/api/company", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(info),
    });
    const body = await res.json();
    setSaving(false);
    if (!res.ok) return setMessage({ ok: false, text: body.error || "保存に失敗しました" });
    setMessage({ ok: true, text: "保存しました" });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">会社情報</h1>
        <p className="mt-1 text-sm text-slate-600">ここで入力した内容は、作成する請求書に印字されます。</p>
      </div>

      {message && (
        <div className={`rounded-md px-4 py-2 text-sm ${message.ok ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>{message.text}</div>
      )}

      {!info ? (
        <p className="text-sm text-slate-500">読み込み中...</p>
      ) : (
        <form onSubmit={save} className="max-w-2xl space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          {FIELDS.map((f) => (
            <div key={f.key}>
              <label htmlFor={f.key} className="mb-1 block text-sm font-medium text-slate-700">
                {f.label}
              </label>
              {f.multiline ? (
                <textarea
                  id={f.key}
                  rows={2}
                  value={info[f.key]}
                  onChange={(e) => setInfo({ ...info, [f.key]: e.target.value })}
                  placeholder={f.placeholder}
                  className={inputClass}
                />
              ) : (
                <input
                  id={f.key}
                  value={info[f.key]}
                  onChange={(e) => setInfo({ ...info, [f.key]: e.target.value })}
                  placeholder={f.placeholder}
                  required={f.key === "name"}
                  className={inputClass}
                />
              )}
              {f.hint && <p className="mt-1 text-xs text-slate-500">{f.hint}</p>}
            </div>
          ))}
          <div className="flex justify-end">
            <button type="submit" disabled={saving} className="rounded-md bg-indigo-600 px-5 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50">
              {saving ? "保存中..." : "保存する"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

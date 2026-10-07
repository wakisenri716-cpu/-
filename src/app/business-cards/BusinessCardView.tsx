"use client";

import { useState } from "react";
import Link from "next/link";
import type { CardFields, CardMatch, PartyKind } from "@/lib/businessCards";

type Item = { card: CardFields; matches: CardMatch[]; kind: PartyKind; target: string; overwrite: boolean; done: { id: string; name: string; created: boolean; filled: string[]; differs: string[] } | null; error: string | null; busy: boolean };

const FIELDS: { key: keyof CardFields; label: string; wide?: boolean }[] = [
  { key: "company", label: "会社名" },
  { key: "name", label: "氏名" },
  { key: "department", label: "部署" },
  { key: "title", label: "役職" },
  { key: "email", label: "メール" },
  { key: "phone", label: "電話" },
  { key: "mobile", label: "携帯" },
  { key: "postalCode", label: "郵便番号" },
  { key: "address", label: "住所", wide: true },
  { key: "website", label: "ホームページ", wide: true },
];
const KIND: Record<PartyKind, string> = { customer: "顧客", vendor: "仕入先" };

export default function BusinessCardView({ ai }: { ai: boolean }) {
  const [items, setItems] = useState<Item[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"photo" | "text" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function read(body: FormData | string, how: "photo" | "text") {
    setBusy(how);
    setError(null);
    setNote(null);
    try {
      const res = await fetch("/api/business-cards/read", typeof body === "string" ? { method: "POST", headers: { "content-type": "application/json" }, body } : { method: "POST", body });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "読み取れませんでした");
      setNote(data.note);
      const fresh: Item[] = data.cards.map((c: { card: CardFields; matches: CardMatch[] }) => {
        const strong = c.matches.find((m) => m.reason !== "メールのドメインが同じ" && m.reason !== "会社名が似ている");
        return { card: c.card, matches: c.matches, kind: strong?.kind ?? "customer", target: strong ? `${strong.kind}:${strong.id}` : "", overwrite: false, done: null, error: null, busy: false };
      });
      setItems((prev) => [...fresh, ...prev]);
      if (how === "text" && fresh.length) setText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み取れませんでした");
    } finally {
      setBusy(null);
    }
  }

  function update(i: number, patch: Partial<Item>) {
    setItems((prev) => prev.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  }

  async function register(i: number) {
    const it = items[i];
    update(i, { busy: true, error: null });
    try {
      const [kind, targetId] = it.target ? it.target.split(":") : [it.kind, null];
      const res = await fetch("/api/business-cards", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, card: it.card, targetId, overwrite: it.overwrite }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "登録できませんでした");
      update(i, { busy: false, done: data });
    } catch (e) {
      update(i, { busy: false, error: e instanceof Error ? e.message : "登録できませんでした" });
    }
  }

  const input = "mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm";
  return (
    <div className="space-y-6">
      <section className="grid gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6 lg:grid-cols-2">
        {ai && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-800">名刺の写真から</p>
            <label className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-indigo-200 bg-indigo-50/50 px-4 py-8 text-center text-sm text-indigo-800 hover:bg-indigo-50 ${busy ? "pointer-events-none opacity-60" : ""}`}>
              <span className="font-medium">{busy === "photo" ? "AIが読み取っています…" : "写真を撮る・選ぶ"}</span>
              <span className="text-xs text-slate-500">JPEG・PNG・PDF(4MBまで)。何枚か並べて撮ってもかまいません</span>
              <input
                type="file"
                accept="image/*,application/pdf"
                className="sr-only"
                disabled={!!busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  const form = new FormData();
                  form.append("file", file);
                  read(form, "photo");
                }}
              />
            </label>
          </div>
        )}
        <div className={`space-y-2 ${ai ? "" : "lg:col-span-2"}`}>
          <p className="text-sm font-medium text-slate-800">名刺の文字から</p>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} placeholder={"株式会社さくら商事\n営業部 課長\n山田 太郎\n〒150-0001 東京都渋谷区神宮前1-2-3\nTEL 03-1234-5678\nt.yamada@sakura-shoji.co.jp"} className={input} />
          <button onClick={() => read(JSON.stringify({ text }), "text")} disabled={!!busy || !text.trim()} className="rounded-md bg-vermilion-600 px-4 py-2 text-sm font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
            {busy === "text" ? "分けています…" : "項目に分ける"}
          </button>
        </div>
        {(note || error) && <p className={`rounded-md px-4 py-2 text-sm lg:col-span-2 ${error ? "bg-rose-50 text-rose-800" : "bg-amber-50 text-amber-900"}`}>{error ?? note}</p>}
      </section>

      {items.map((it, i) => (
        <section key={i} className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold">
              {it.card.company ?? it.card.name ?? "名刺"}
              {it.card.company && it.card.name && <span className="ml-2 text-sm font-normal text-slate-600">{it.card.name} 様</span>}
            </h2>
            {!it.done && (
              <button onClick={() => setItems((prev) => prev.filter((_, j) => j !== i))} className="text-xs text-slate-500 hover:text-slate-800">
                取り消す
              </button>
            )}
          </div>
          {it.done ? (
            <div className="rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
              <p>
                {it.done.created ? `「${it.done.name}」を${KIND[it.kind]}として登録しました。` : `「${it.done.name}」に${it.done.filled.length ? `${it.done.filled.join("・")}を追加しました。` : "追加する項目はありませんでした。"}`}
              </p>
              {it.done.differs.length > 0 && <p className="mt-1 text-amber-800">登録済みの内容と違う項目({it.done.differs.join("・")})はそのままにしました。名刺が新しいときは取引先の画面で直してください。</p>}
              <Link href={`/vendors/${it.target ? it.target.split(":")[0] : it.kind}/${it.done.id}`} className="mt-1 inline-block text-indigo-700 underline">
                取引先カルテを見る
              </Link>
            </div>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                {FIELDS.map((f) => (
                  <label key={f.key} className={`block text-sm ${f.wide ? "sm:col-span-2" : ""}`}>
                    <span className="text-slate-700">{f.label}</span>
                    <input value={it.card[f.key] ?? ""} onChange={(e) => update(i, { card: { ...it.card, [f.key]: e.target.value || null } })} className={input} />
                  </label>
                ))}
              </div>
              <div className="space-y-2 rounded-lg bg-slate-50 p-3 text-sm">
                <p className="font-medium text-slate-800">登録先</p>
                {it.matches.map((m) => (
                  <label key={`${m.kind}:${m.id}`} className="flex items-start gap-2">
                    <input type="radio" name={`target-${i}`} checked={it.target === `${m.kind}:${m.id}`} onChange={() => update(i, { target: `${m.kind}:${m.id}`, kind: m.kind })} className="mt-1" />
                    <span>
                      登録済みの{KIND[m.kind]}「{m.name}」に追加<span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900">{m.reason}</span>
                      <span className="block text-xs text-slate-500">{[m.contactName && `担当 ${m.contactName}`, m.phone, m.email, m.address].filter(Boolean).join(" / ") || "担当者・連絡先はまだありません"}</span>
                    </span>
                  </label>
                ))}
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-2">
                    <input type="radio" name={`target-${i}`} checked={!it.target} onChange={() => update(i, { target: "" })} />
                    新しく登録:
                  </label>
                  <select value={it.kind} onChange={(e) => update(i, { kind: e.target.value as PartyKind, target: "" })} className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm">
                    <option value="customer">顧客(売る相手)</option>
                    <option value="vendor">仕入先(買う相手)</option>
                  </select>
                </div>
                {it.target && (
                  <label className="flex items-center gap-2 text-xs text-slate-600">
                    <input type="checkbox" checked={it.overwrite} onChange={(e) => update(i, { overwrite: e.target.checked })} />
                    登録済みの内容と違う項目も、名刺の内容で書き換える(異動・移転のとき)
                  </label>
                )}
                {it.kind === "vendor" && it.card.email && <p className="text-xs text-slate-500">仕入先にはメールの欄がないため、メールは登録されません。</p>}
              </div>
              {it.error && <p className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-800">{it.error}</p>}
              <button onClick={() => register(i)} disabled={it.busy || !(it.card.company || it.card.name)} className="rounded-md bg-vermilion-600 px-4 py-2 text-sm font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
                {it.busy ? "登録しています…" : it.target ? "この相手に追加する" : `${KIND[it.kind]}として登録する`}
              </button>
            </>
          )}
        </section>
      ))}
    </div>
  );
}

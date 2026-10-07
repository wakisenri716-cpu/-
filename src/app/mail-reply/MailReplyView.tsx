"use client";

import { useState } from "react";
import Link from "next/link";
import type { MailReplyResult } from "@/lib/mailReply";

const yen = (n: number) => `${n.toLocaleString("ja-JP")}円`;
const md = (d: string | null) => (d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : "-");

export default function MailReplyView({ customers, ai }: { customers: { id: string; name: string }[]; ai: boolean }) {
  const [mail, setMail] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [sender, setSender] = useState("");
  const [notes, setNotes] = useState("");
  const [result, setResult] = useState<MailReplyResult | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState<"template" | "ai" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function make(useAi: boolean) {
    setBusy(useAi ? "ai" : "template");
    setError(null);
    try {
      const res = await fetch("/api/mail-reply", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mail, customerId, sender, notes, useAi }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "うまくいきませんでした");
      setResult(data);
      setSubject(data.subject);
      setBody(data.body);
      setCopied(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "うまくいきませんでした");
    } finally {
      setBusy(null);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(`件名: ${subject}\n\n${body}`);
      setCopied(true);
    } catch {
      setError("コピーできませんでした。本文を選んでコピーしてください");
    }
  }

  const input = "mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm";
  const f = result?.facts;
  return (
    <div className="space-y-6">
      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <label className="block text-sm">
          <span className="text-slate-700">届いたメール(差出人・件名の行があればいっしょに)</span>
          <textarea value={mail} onChange={(e) => setMail(e.target.value)} rows={9} placeholder={"差出人: 山田 太郎 <t.yamada@sakura-shoji.co.jp>\n件名: 請求書の再発行のお願い\n\nいつもお世話になっております。さくら商事の山田です。\n先日いただいた請求書を紛失してしまいました。お手数ですが再送いただけますでしょうか。"} className={input} />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="text-slate-700">顧客(空ならメールから探します)</span>
            <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className={input}>
              <option value="">メールから探す</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-slate-700">あなたの名前(任意)</span>
            <input value={sender} onChange={(e) => setSender(e.target.value)} placeholder="空ならログインしている人の名前" className={input} />
          </label>
          {ai && (
            <label className="block text-sm sm:col-span-2">
              <span className="text-slate-700">返信の方針(任意・AIに伝えます)</span>
              <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="例: 支払いは今月末まで待つ。それ以上は難しいとやわらかく伝えたい" className={input} />
            </label>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => make(false)} disabled={!!busy || !mail.trim()} className="rounded-md bg-vermilion-600 px-4 py-2 text-sm font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
            {busy === "template" ? "作っています…" : "下書きを作る"}
          </button>
          {ai && (
            <button onClick={() => make(true)} disabled={!!busy || !mail.trim()} className="rounded-md border border-indigo-300 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50">
              {busy === "ai" ? "AIが書いています…" : "AIで書く"}
            </button>
          )}
        </div>
        {error && <p className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-800">{error}</p>}
      </section>

      {result && f && (
        <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
          <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-slate-600">用件:</span>
              {result.intents.length ? (
                result.intents.map((i) => (
                  <span key={i.key} className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs text-indigo-800">
                    {i.label}
                  </span>
                ))
              ) : (
                <span className="text-xs text-slate-500">見分けられませんでした(一般的な返信)</span>
              )}
              <span className="ml-auto text-xs text-slate-500">{result.mode === "claude" ? "AIが書きました" : "ひな形の下書き"}</span>
            </div>
            <label className="block text-sm">
              <span className="text-slate-700">件名</span>
              <input value={subject} onChange={(e) => setSubject(e.target.value)} className={input} />
            </label>
            <label className="block text-sm">
              <span className="text-slate-700">本文(直してから送ってください)</span>
              <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={18} className={`${input} font-[inherit] leading-relaxed`} />
            </label>
            {result.cautions.length > 0 && (
              <ul className="space-y-1 rounded-md bg-amber-50 px-4 py-2 text-sm text-amber-900">
                {result.cautions.map((c) => (
                  <li key={c}>・{c}</li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap gap-2">
              <button onClick={copy} className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50">
                {copied ? "コピーしました" : "件名と本文をコピー"}
              </button>
              <a href={`mailto:${encodeURIComponent(result.to ?? "")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`} className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50">
                メールソフトで開く{result.to ? `(${result.to})` : ""}
              </a>
            </div>
          </section>

          <aside className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
            <div>
              <p className="font-medium text-slate-800">相手</p>
              {result.customer ? (
                <p className="mt-1">
                  {result.customer.name}
                  <span className="ml-1 text-xs text-slate-500">({result.customer.reason})</span>
                </p>
              ) : (
                <p className="mt-1 text-slate-500">顧客が見つかりませんでした</p>
              )}
            </div>
            {result.customer && (
              <>
                <div>
                  <p className="font-medium text-slate-800">入金待ちの請求書</p>
                  {f.open.length ? (
                    <ul className="mt-1 space-y-1">
                      {f.open.map((i) => (
                        <li key={i.number} className="flex justify-between gap-2">
                          <span>
                            No.{i.number} <span className="text-xs text-slate-500">期限 {md(i.dueDate)}</span>
                            {i.overdueDays > 0 && <span className="ml-1 rounded bg-rose-50 px-1 text-xs text-rose-700">{i.overdueDays}日過ぎ</span>}
                          </span>
                          <span className="tabular-nums">{yen(i.remaining)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-slate-500">ありません</p>
                  )}
                </div>
                <div>
                  <p className="font-medium text-slate-800">最近の入金(45日)</p>
                  {f.recentPayments.length ? (
                    <ul className="mt-1 space-y-1">
                      {f.recentPayments.map((p, i) => (
                        <li key={i} className="flex justify-between gap-2">
                          <span>
                            {md(p.date)} <span className="text-xs text-slate-500">No.{p.invoice}</span>
                          </span>
                          <span className="tabular-nums">{yen(p.amount)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-slate-500">ありません</p>
                  )}
                </div>
                <div>
                  <p className="font-medium text-slate-800">出している見積</p>
                  {f.quotes.length ? (
                    <ul className="mt-1 space-y-1">
                      {f.quotes.map((q) => (
                        <li key={q.number} className="flex justify-between gap-2">
                          <span>
                            No.{q.number} <span className="text-xs text-slate-500">有効 {md(q.validUntil)}まで</span>
                          </span>
                          <span className="tabular-nums">{yen(q.total)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-slate-500">ありません</p>
                  )}
                </div>
                <Link href="/collections" className="inline-block text-xs text-indigo-700 underline">
                  督促・回収を見る
                </Link>
              </>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

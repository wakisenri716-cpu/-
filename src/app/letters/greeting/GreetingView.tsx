"use client";

import { useState } from "react";
import type { GreetingKind, GREETING_KINDS } from "@/lib/greetingLetters";
import { PrintButton } from "@/components/PrintButton";
import GreetingMailPanel, { type MailRecipient } from "./GreetingMailPanel";
import type { MailSender } from "@/lib/greetingMailText";

type Kinds = typeof GREETING_KINDS;
type Party = { kind: "customer" | "vendor"; id: string; name: string };
type Letter = {
  title: string;
  date: string;
  to: { lines: string[]; main: string } | null;
  company: { name: string; address: string | null; phone: string | null };
  sender: string;
  subject: string;
  opening: string;
  body: string[];
  closing: string;
  notes: string[];
  mode: "claude" | "template";
};
const ORDER: GreetingKind[] = ["THANKS", "HOLIDAY", "CLOSURE", "MOVE", "PERSON", "APOLOGY", "LAUNCH"];
const jp = (key: string) => `${Number(key.slice(0, 4))}年${Number(key.slice(5, 7))}月${Number(key.slice(8, 10))}日`;

export default function GreetingView({ kinds, parties, today, ai, mail, initial }: { kinds: Kinds; parties: Party[]; today: string; ai: boolean; mail: { recipients: MailRecipient[]; me: Omit<MailSender, "sender"> } | null; initial?: { kind: GreetingKind; fields: Record<string, string> } }) {
  const [kind, setKind] = useState<GreetingKind>(initial?.kind ?? "THANKS");
  const [fields, setFields] = useState<Record<string, string>>(initial?.fields ?? {});
  const [party, setParty] = useState("");
  const [date, setDate] = useState(today);
  const [sender, setSender] = useState("");
  const [notes, setNotes] = useState("");
  const [letter, setLetter] = useState<Letter | null>(null);
  const [busy, setBusy] = useState<"template" | "ai" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function make(useAi: boolean) {
    setBusy(useAi ? "ai" : "template");
    setError(null);
    try {
      const [partyKind, partyId] = party ? party.split(":") : [null, null];
      const res = await fetch("/api/letters/greeting", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, fields, partyKind, partyId, date, sender, notes, useAi }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "うまくいきませんでした");
      setLetter(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "うまくいきませんでした");
    } finally {
      setBusy(null);
    }
  }

  const input = "mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm";
  return (
    <div className="space-y-6">
      <div className="space-y-6 print:hidden">
        <div className="flex flex-wrap gap-2" role="tablist">
          {ORDER.map((k) => (
            <button
              key={k}
              role="tab"
              aria-selected={kind === k}
              onClick={() => {
                setKind(k);
                setFields({});
                setLetter(null);
              }}
              className={`rounded-full border px-3 py-1.5 text-sm ${kind === k ? "border-indigo-700 bg-indigo-700 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
            >
              {kinds[k].title}
            </button>
          ))}
        </div>
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="text-slate-700">宛先(住所録から・任意)</span>
              <select value={party} onChange={(e) => setParty(e.target.value)} className={input}>
                <option value="">宛名なし(みなさま向け)</option>
                {parties.map((p) => (
                  <option key={`${p.kind}:${p.id}`} value={`${p.kind}:${p.id}`}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-slate-700">日付</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={input} />
            </label>
            {kinds[kind].fields.map((f) => (
              <label key={f.key} className={`block text-sm ${f.multiline ? "sm:col-span-2" : ""}`}>
                <span className="text-slate-700">
                  {f.label}
                  {f.required ? "" : "(任意)"}
                </span>
                {f.multiline ? (
                  <textarea value={fields[f.key] ?? ""} onChange={(e) => setFields({ ...fields, [f.key]: e.target.value })} rows={2} placeholder={f.placeholder} className={input} />
                ) : (
                  <input value={fields[f.key] ?? ""} onChange={(e) => setFields({ ...fields, [f.key]: e.target.value })} placeholder={f.placeholder} className={input} />
                )}
              </label>
            ))}
            <label className="block text-sm">
              <span className="text-slate-700">差出人の名前(任意)</span>
              <input value={sender} onChange={(e) => setSender(e.target.value)} placeholder="例: 代表取締役 山田太郎" className={input} />
            </label>
            {ai && (
              <label className="block text-sm sm:col-span-2">
                <span className="text-slate-700">AIに伝えること(任意)</span>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="例: 創業10年の節目。長くお付き合いいただいている取引先に、感謝を少し温かめに伝えたい" className={input} />
              </label>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => make(false)} disabled={!!busy} className="rounded-md bg-vermilion-600 px-4 py-2 text-sm font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
              {busy === "template" ? "作っています…" : "ひな形で作る"}
            </button>
            {ai && (
              <button onClick={() => make(true)} disabled={!!busy} className="rounded-md border border-indigo-300 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50">
                {busy === "ai" ? "AIが書いています…" : "AIで本文を書く"}
              </button>
            )}
          </div>
          {error && <p className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-800">{error}</p>}
        </section>
      </div>

      {letter && (
        <div className="space-y-3">
          <div className="flex items-center justify-between print:hidden">
            <p className="text-sm text-slate-600">{letter.mode === "claude" ? "AIが本文を書きました。" : "ひな形の下書きです。"}内容を確かめてから印刷してください。</p>
            <PrintButton variant="outline" />
          </div>
          <article className="mx-auto max-w-[210mm] space-y-5 bg-white p-8 text-[13.5px] leading-relaxed text-slate-900 shadow-sm ring-1 ring-slate-200 sm:p-[20mm] print:max-w-none print:p-0 print:shadow-none print:ring-0">
            <p className="text-right">{jp(letter.date)}</p>
            <div className="flex flex-wrap justify-between gap-4">
              <div>
                {letter.to ? (
                  <>
                    {letter.to.lines.map((l) => (
                      <p key={l}>{l}</p>
                    ))}
                    <p className="text-lg font-semibold">{letter.to.main}</p>
                  </>
                ) : (
                  <p className="text-lg font-semibold">お取引先各位</p>
                )}
              </div>
              <div className="text-right">
                <p className="font-semibold">{letter.company.name}</p>
                {letter.company.address && <p>{letter.company.address}</p>}
                {letter.company.phone && <p>TEL: {letter.company.phone}</p>}
                <p>{letter.sender}</p>
              </div>
            </div>
            <h2 className="text-center text-lg font-semibold">{letter.subject}</h2>
            <p>{letter.opening}</p>
            {letter.body.map((p, i) => (
              <p key={i} className="indent-[1em]">
                {p}
              </p>
            ))}
            <p className="text-right">{letter.closing}</p>
            {letter.notes.length > 0 && (
              <div className="space-y-1">
                <p className="text-center">記</p>
                {letter.notes.map((n) => (
                  <p key={n} className="pl-[2em]">
                    {n}
                  </p>
                ))}
                <p className="text-right">以上</p>
              </div>
            )}
          </article>
          {mail && <GreetingMailPanel key={`${letter.subject}:${letter.body.join("")}`} letter={letter} recipients={mail.recipients} me={mail.me} />}
        </div>
      )}
    </div>
  );
}

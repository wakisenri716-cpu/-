"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  greetingMailText,
  type MailAddressee,
  type MailSender,
} from "@/lib/greetingMailText";

export type MailRecipient = {
  id: string;
  name: string;
  email: string;
  to: MailAddressee;
};

// 作った挨拶状を、メールアドレスのある顧客に1社ずつ宛名を入れてメールで送る
export default function GreetingMailPanel({
  letter,
  recipients,
  me,
}: {
  letter: { subject: string; body: string[]; notes: string[]; sender: string };
  recipients: MailRecipient[];
  me: Omit<MailSender, "sender">;
}) {
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState(letter.subject);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(recipients.map((r) => r.id)),
  );
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const shown = recipients.filter(
    (r) =>
      !query.trim() ||
      r.name.includes(query.trim()) ||
      r.email.includes(query.trim()),
  );
  const first = recipients.find((r) => selected.has(r.id)) ?? recipients[0];
  const preview = useMemo(
    () =>
      first
        ? greetingMailText(first.to, letter, { ...me, sender: letter.sender })
        : "",
    [first, letter, me],
  );

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function send() {
    if (
      !window.confirm(
        `「${subject}」を${selected.size}社にメールで送ります。よろしいですか?`,
      )
    )
      return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/letters/greeting/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          subject,
          body: letter.body,
          notes: letter.notes,
          sender: letter.sender,
          recipients: [...selected],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "送れませんでした");
      const parts = [
        data.sent ? `${data.sent}社に送りました` : null,
        data.test
          ? `${data.test}社分をテストモードで記録しました(実際には送っていません)`
          : null,
        data.skipped.length
          ? `24時間以内に同じ件名で送った${data.skipped.length}社(${data.skipped.slice(0, 3).join("・")}${data.skipped.length > 3 ? "ほか" : ""})には送りませんでした`
          : null,
        data.failed.length
          ? `${data.failed.length}社は送れませんでした(${data.failed.slice(0, 3).join("・")})${data.stopped ? "。途中で止めました" : ""}`
          : null,
      ].filter(Boolean);
      setResult(parts.join("。") || "送る相手がいませんでした");
    } catch (e) {
      setError(e instanceof Error ? e.message : "送れませんでした");
    } finally {
      setBusy(false);
    }
  }

  if (!open)
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-3 text-sm print:hidden">
        <span className="text-slate-700">
          この挨拶状を、メールアドレスのある顧客({recipients.length}
          社)にメールでも送れます。
        </span>
        <button
          onClick={() => setOpen(true)}
          disabled={!recipients.length}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50 disabled:opacity-50"
        >
          メールでまとめて送る
        </button>
        {!recipients.length && (
          <Link href="/vendors" className="text-xs text-indigo-700 underline">
            住所録で顧客のメールアドレスを入れる
          </Link>
        )}
      </div>
    );

  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm sm:p-6 print:hidden">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">メールでまとめて送る</h2>
        <button
          onClick={() => setOpen(false)}
          className="text-xs text-slate-500 hover:text-slate-700"
        >
          閉じる
        </button>
      </div>
      <p className="text-slate-600">
        1社ずつ宛名(会社名・担当者)を入れて送ります(ほかの相手のアドレスは見えません)。返信は会社のメールアドレスに届きます。
      </p>
      <label className="block">
        <span className="text-slate-700">件名</span>
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5"
        />
      </label>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-slate-700">
              送る相手 {selected.size}/{recipients.length}社
            </span>
            <button
              onClick={() => setSelected(new Set(recipients.map((r) => r.id)))}
              className="text-xs text-indigo-700 underline"
            >
              すべて選ぶ
            </button>
            <button
              onClick={() => setSelected(new Set())}
              className="text-xs text-indigo-700 underline"
            >
              すべて外す
            </button>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="名前で絞る"
              aria-label="名前で絞る"
              className="ml-auto w-32 rounded-md border border-slate-300 px-2 py-1 text-xs"
            />
          </div>
          <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-200">
            {shown.map((r) => (
              <li key={r.id}>
                <label className="flex items-center gap-2 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={selected.has(r.id)}
                    onChange={() => toggle(r.id)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">
                      {[...r.to.lines, r.to.main].join(" ")}
                    </span>
                    <span className="block truncate text-xs text-slate-500">
                      {r.email}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
        <div className="space-y-1">
          <span className="text-slate-700">
            メールの見本{first ? `(${first.name})` : ""}
          </span>
          <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-3 font-sans text-xs leading-relaxed text-slate-800">
            {preview}
          </pre>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={send}
          disabled={busy || !selected.size || !subject.trim()}
          className="rounded-md bg-vermilion-600 px-4 py-2 font-medium text-white hover:bg-vermilion-700 disabled:opacity-50"
        >
          {busy ? "送っています…" : `${selected.size}社に送る`}
        </button>
        <span className="text-xs text-slate-500">
          送ったメールは「メール」の送信記録に残ります。
        </span>
      </div>
      {error && (
        <p className="rounded-md bg-rose-50 px-4 py-2 text-rose-800">{error}</p>
      )}
      {result && (
        <p className="rounded-md bg-emerald-50 px-4 py-2 text-emerald-800">
          {result}
        </p>
      )}
    </section>
  );
}

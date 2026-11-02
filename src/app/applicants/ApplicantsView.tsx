"use client";

import { useState } from "react";

type Applicant = { id: string; name: string; email: string | null; phone: string | null; position: string | null; source: string | null; status: string; appliedOn: string; interviewDate: string | null; interviewTime: string | null; interviewerId: string | null; interviewerName: string | null; staffId?: string | null; note: string | null };
type Data = { applicants: Applicant[]; purgeable: number };
type Draft = { name: string; email: string | null; phone: string | null; position: string | null; source: string | null };
type Hire = { id: string; hireDate: string; hourlyWage: string };
type Mail = { id: string; kind: string; to: string; subject: string; body: string; mode: string };

const input = "w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm";
const STATUS: Record<string, string> = { APPLIED: "応募", INTERVIEW: "面接", OFFER: "内定", HIRED: "入社", REJECTED: "不採用", WITHDRAWN: "辞退" };
const TONE: Record<string, string> = { APPLIED: "bg-amber-50 text-amber-900", INTERVIEW: "bg-indigo-50 text-indigo-800", OFFER: "bg-emerald-50 text-emerald-800", HIRED: "bg-emerald-600 text-white", REJECTED: "bg-slate-100 text-slate-500", WITHDRAWN: "bg-slate-100 text-slate-500" };
const md = (k: string) => `${Number(k.slice(5, 7))}/${Number(k.slice(8, 10))}`;

export default function ApplicantsView({ initial, users, ai }: { initial: Data; users: { id: string; name: string }[]; ai: boolean }) {
  const [data, setData] = useState(initial);
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [sched, setSched] = useState<{ id: string; date: string; time: string; interviewerId: string } | null>(null);
  const [mail, setMail] = useState<Mail | null>(null);
  const [hire, setHire] = useState<Hire | null>(null);
  const [questions, setQuestions] = useState<{ id: string; list: string[]; removed: number; mode: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  async function call(url: string, method: string, body?: unknown) {
    const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "うまくいきませんでした");
    return json;
  }
  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setError(null);
    setFlash(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "うまくいきませんでした");
    } finally {
      setBusy(null);
    }
  }
  const reload = async () => setData(await call("/api/applicants", "GET"));
  const parse = () => run("parse", async () => setDraft((await call("/api/applicants", "POST", { action: "parse", text })).draft));
  const save = () =>
    run("save", async () => {
      const { applicant } = await call("/api/applicants", "POST", draft);
      setFlash(`${applicant.name}さんを記録しました`);
      setDraft(null);
      setText("");
      await reload();
    });
  const setStatus = (a: Applicant, status: string) => run(a.id, async () => {
    await call(`/api/applicants/${a.id}`, "PATCH", { status });
    await reload();
  });
  const saveSched = () =>
    run("sched", async () => {
      if (!sched) return;
      await call(`/api/applicants/${sched.id}`, "PATCH", { interviewDate: sched.date, interviewTime: sched.time, interviewerId: sched.interviewerId });
      setFlash("面接の日時を入れました。来客の受付簿にも予定を入れました");
      setSched(null);
      await reload();
    });
  const draftMail = (a: Applicant, kind: string, useAi = false) =>
    run(`${a.id}-mail`, async () => {
      const d = await call(`/api/applicants/${a.id}`, "POST", { action: "draft", kind, useAi });
      setMail({ id: a.id, kind, to: d.to ?? "", subject: d.subject, body: d.body, mode: d.mode });
    });
  const sendMail = () =>
    run("send", async () => {
      if (!mail) return;
      await call(`/api/applicants/${mail.id}`, "POST", { action: "send", ...mail });
      setFlash(`${mail.to} にメールを送りました`);
      setMail(null);
      await reload();
    });
  const draftQuestions = (a: Applicant, useAi: boolean) =>
    run(`${a.id}-q`, async () => {
      const r = await call(`/api/applicants/${a.id}`, "POST", { action: "questions", useAi });
      setQuestions({ id: a.id, list: r.questions, removed: r.removed, mode: r.mode });
    });
  const saveHire = () =>
    run("hire", async () => {
      if (!hire) return;
      const r = await call(`/api/applicants/${hire.id}`, "POST", { action: "hire", hireDate: hire.hireDate, hourlyWage: hire.hourlyWage });
      setFlash(`${r.staff.name}さんを労働者名簿に${r.staff.reused ? "(同じ名前のスタッフに)" : ""}入れました。入社・退職の手続きに届出の一覧が出ます`);
      setHire(null);
      await reload();
    });
  const purge = () =>
    run("purge", async () => {
      if (!confirm(`不採用・辞退から6か月たった応募者${data.purgeable}人の情報を消します。元に戻せません。よろしいですか?`)) return;
      const r = await call("/api/applicants", "POST", { action: "purge" });
      setFlash(`${r.count}人の情報を消しました`);
      await reload();
    });

  const active = data.applicants.filter((a) => ["APPLIED", "INTERVIEW", "OFFER"].includes(a.status));
  const closed = data.applicants.filter((a) => !["APPLIED", "INTERVIEW", "OFFER"].includes(a.status));
  const card = (a: Applicant) => (
    <li key={a.id} className="space-y-2 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className={`rounded-full px-2 py-0.5 text-xs ${TONE[a.status]}`}>{STATUS[a.status]}</span>
        <span className="font-medium">{a.name}</span>
        {a.position && <span className="text-slate-600">{a.position}</span>}
        <span className="text-xs text-slate-500">
          {md(a.appliedOn)}応募{a.source ? `・${a.source}` : ""}
          {a.phone ? `・${a.phone}` : ""}
          {a.email ? `・${a.email}` : ""}
        </span>
        {a.interviewDate && (
          <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-800">
            面接 {md(a.interviewDate)} {a.interviewTime ?? ""}
            {a.interviewerName ? `(${a.interviewerName})` : ""}
          </span>
        )}
      </div>
      {["APPLIED", "INTERVIEW", "OFFER"].includes(a.status) && (
        <div className="flex flex-wrap gap-2 text-xs">
          <button onClick={() => setSched({ id: a.id, date: a.interviewDate ?? "", time: a.interviewTime ?? "", interviewerId: a.interviewerId ?? "" })} className="rounded-md border border-slate-300 bg-white px-2.5 py-1 hover:bg-slate-50">
            面接の日時
          </button>
          {a.interviewDate && (
            <button onClick={() => draftMail(a, "INTERVIEW")} disabled={!!busy} className="rounded-md border border-slate-300 bg-white px-2.5 py-1 hover:bg-slate-50">
              面接のご案内メール
            </button>
          )}
          <button onClick={() => draftQuestions(a, false)} disabled={!!busy} className="rounded-md border border-slate-300 bg-white px-2.5 py-1 hover:bg-slate-50">
            面接の質問案
          </button>
          <button onClick={() => draftMail(a, "OFFER")} disabled={!!busy} className="rounded-md border border-emerald-300 bg-white px-2.5 py-1 text-emerald-800 hover:bg-emerald-50">
            内定のメール
          </button>
          <button onClick={() => draftMail(a, "REJECT")} disabled={!!busy} className="rounded-md border border-slate-300 bg-white px-2.5 py-1 hover:bg-slate-50">
            不採用のメール
          </button>
          {a.status === "OFFER" && (
            <button onClick={() => setHire({ id: a.id, hireDate: "", hourlyWage: "" })} disabled={!!busy} className="rounded-md bg-emerald-600 px-2.5 py-1 font-medium text-white">
              入社した
            </button>
          )}
          <button onClick={() => setStatus(a, "WITHDRAWN")} disabled={!!busy} className="text-slate-400 hover:text-slate-700">
            辞退
          </button>
        </div>
      )}
      {questions?.id === a.id && (
        <div className="space-y-1.5 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
            <span>
              {questions.mode === "claude" ? "AIが仕事に合わせて作りました" : "よく使う質問です"}
              {questions.removed ? `(就職差別につながるおそれのある質問を${questions.removed}つ外しました)` : ""}。本籍・家族・思想・宗教などは聞かないでください。
            </span>
            <span className="flex gap-2">
              {ai && (
                <button onClick={() => draftQuestions(a, true)} disabled={!!busy} className="rounded-md border border-indigo-300 bg-indigo-50 px-2.5 py-1 font-medium text-indigo-700">
                  {busy === `${a.id}-q` ? "AIが考えています…" : "AIで仕事に合わせる"}
                </button>
              )}
              <button onClick={() => setQuestions(null)} className="text-slate-500">
                閉じる
              </button>
            </span>
          </div>
          <ol className="list-decimal space-y-0.5 pl-5">
            {questions.list.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ol>
        </div>
      )}
      {hire?.id === a.id && (
        <div className="flex flex-wrap items-end gap-2 rounded-md bg-emerald-50 p-2">
          <label className="text-xs text-slate-600">
            入社日
            <input aria-label="入社日" type="date" value={hire.hireDate} onChange={(e) => setHire({ ...hire, hireDate: e.target.value })} className="block rounded-md border border-slate-300 px-2 py-1 text-sm" />
          </label>
          <label className="text-xs text-slate-600">
            時給(月給の人は目安)
            <input aria-label="時給" inputMode="numeric" value={hire.hourlyWage} onChange={(e) => setHire({ ...hire, hourlyWage: e.target.value })} placeholder="例: 1200" className="block w-28 rounded-md border border-slate-300 px-2 py-1 text-sm" />
          </label>
          <button onClick={saveHire} disabled={!!busy || !hire.hireDate || !hire.hourlyWage} className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
            労働者名簿に入れる
          </button>
          <button onClick={() => setHire(null)} className="text-sm text-slate-500">
            やめる
          </button>
        </div>
      )}
      {a.status === "HIRED" && a.staffId && (
        <p className="flex flex-wrap gap-3 text-xs">
          <a href="/staff-records" className="text-indigo-700 underline">
            労働者名簿
          </a>
          <a href="/hr-procedures" className="text-indigo-700 underline">
            入社の手続き(届出)
          </a>
        </p>
      )}
      {sched?.id === a.id && (
        <div className="flex flex-wrap items-end gap-2 rounded-md bg-slate-50 p-2">
          <input aria-label="面接の日" type="date" value={sched.date} onChange={(e) => setSched({ ...sched, date: e.target.value })} className="rounded-md border border-slate-300 px-2 py-1 text-sm" />
          <input aria-label="面接の時刻" type="time" value={sched.time} onChange={(e) => setSched({ ...sched, time: e.target.value })} className="rounded-md border border-slate-300 px-2 py-1 text-sm" />
          <select aria-label="面接する人" value={sched.interviewerId} onChange={(e) => setSched({ ...sched, interviewerId: e.target.value })} className="rounded-md border border-slate-300 px-2 py-1 text-sm">
            <option value="">面接する人</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          <button onClick={saveSched} disabled={!!busy || !sched.date} className="rounded-md bg-vermilion-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
            入れる
          </button>
          <button onClick={() => setSched(null)} className="text-sm text-slate-500">
            やめる
          </button>
        </div>
      )}
      {mail?.id === a.id && (
        <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
            <span>{mail.mode === "claude" ? "AIが整えました" : "決まった形で書きました"}(直せます)</span>
            {ai && (
              <button onClick={() => draftMail(a, mail.kind, true)} disabled={!!busy} className="rounded-md border border-indigo-300 bg-indigo-50 px-2.5 py-1 font-medium text-indigo-700">
                {busy === `${a.id}-mail` ? "AIが書いています…" : "AIで整える"}
              </button>
            )}
          </div>
          <input aria-label="宛先" type="email" placeholder="応募者のメールアドレス" value={mail.to} onChange={(e) => setMail({ ...mail, to: e.target.value })} className={input} />
          <input aria-label="件名" value={mail.subject} onChange={(e) => setMail({ ...mail, subject: e.target.value })} className={input} />
          <textarea aria-label="本文" value={mail.body} onChange={(e) => setMail({ ...mail, body: e.target.value })} rows={12} className={`${input} leading-relaxed`} />
          <div className="flex gap-2">
            <button onClick={sendMail} disabled={!!busy || !mail.to.trim()} className="rounded-md bg-vermilion-600 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50">
              {busy === "send" ? "送っています…" : "送る"}
            </button>
            <button onClick={() => setMail(null)} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm">
              閉じる
            </button>
          </div>
        </div>
      )}
    </li>
  );

  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm sm:p-6">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && text.trim() && parse()} placeholder="例: 鈴木 一郎 ホールスタッフ Indeed 090-1234-5678" className={input} />
          <button onClick={parse} disabled={!!busy || !text.trim()} className="shrink-0 rounded-md bg-vermilion-600 px-4 py-2 font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
            {busy === "parse" ? "読み取っています…" : "読み取る"}
          </button>
        </div>
        {draft && (
          <div className="space-y-2 rounded-md border border-slate-200 p-3">
            <div className="grid gap-2 sm:grid-cols-5">
              <input aria-label="名前" placeholder="名前" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={input} />
              <input aria-label="応募した仕事" placeholder="応募した仕事" value={draft.position ?? ""} onChange={(e) => setDraft({ ...draft, position: e.target.value || null })} className={input} />
              <input aria-label="応募経路" placeholder="応募経路" value={draft.source ?? ""} onChange={(e) => setDraft({ ...draft, source: e.target.value || null })} className={input} />
              <input aria-label="電話" placeholder="電話" value={draft.phone ?? ""} onChange={(e) => setDraft({ ...draft, phone: e.target.value || null })} className={input} />
              <input aria-label="メール" placeholder="メール" value={draft.email ?? ""} onChange={(e) => setDraft({ ...draft, email: e.target.value || null })} className={input} />
            </div>
            <button onClick={save} disabled={!!busy} className="rounded-md bg-vermilion-600 px-4 py-2 font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
              {busy === "save" ? "記録しています…" : "記録する"}
            </button>
          </div>
        )}
        {error && <p className="rounded-md bg-rose-50 px-3 py-2 text-rose-800">{error}</p>}
        {flash && <p className="rounded-md bg-emerald-50 px-3 py-2 text-emerald-800">{flash}</p>}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
        <h2 className="font-semibold">選考中({active.length}人)</h2>
        {active.length ? <ul className="divide-y divide-slate-100">{active.map(card)}</ul> : <p className="mt-2 text-slate-500">選考中の応募者はいません。</p>}
      </section>

      {(closed.length > 0 || data.purgeable > 0) && (
        <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">選考が終わった人(6か月)</h2>
            {data.purgeable > 0 && (
              <button onClick={purge} disabled={!!busy} className="rounded-md border border-rose-300 bg-white px-3 py-1.5 text-xs text-rose-700 hover:bg-rose-50">
                6か月より前の不採用・辞退 {data.purgeable}人の情報を消す
              </button>
            )}
          </div>
          {closed.length > 0 && <ul className="divide-y divide-slate-100">{closed.map(card)}</ul>}
        </section>
      )}
    </div>
  );
}

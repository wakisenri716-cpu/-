"use client";

import { useEffect, useState } from "react";

type Dependent = { name: string; relation: string; birthYear: string; income: string; livingTogether: boolean };
type Form = {
  spouse: boolean;
  spouseBirthYear: string;
  spouseIncome: string;
  dependents: Dependent[];
  lifeGeneral: string;
  lifeMedical: string;
  lifePension: string;
  earthquake: string;
  socialDeclared: string;
  ideco: string;
  housingLoan: string;
  prevPay: string;
  prevSocial: string;
  prevTax: string;
  oldSystemLife: boolean;
  note: string;
};
type Mine = { year: number; linked: boolean; name?: string; submission: { status: string; reply: string | null; data: Record<string, unknown> } | null };
const EMPTY: Form = { spouse: false, spouseBirthYear: "", spouseIncome: "", dependents: [], lifeGeneral: "", lifeMedical: "", lifePension: "", earthquake: "", socialDeclared: "", ideco: "", housingLoan: "", prevPay: "", prevSocial: "", prevTax: "", oldSystemLife: false, note: "" };
const STATUS: Record<string, string> = { SUBMITTED: "総務の確認待ち", APPLIED: "総務が年末調整に入れました", RETURNED: "総務から確かめてほしいことがあります" };
const CERT_LABEL: Record<string, string> = { lifeGeneral: "生命保険料(一般)", lifeMedical: "介護医療保険料", lifePension: "個人年金保険料", earthquake: "地震保険料", socialDeclared: "国民年金など", ideco: "iDeCoなど" };
const box = "w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm";
const s = (v: unknown) => (v === null || v === undefined || v === 0 ? "" : String(v));

function fromData(d: Record<string, unknown>): Form {
  const deps = Array.isArray(d.dependents) ? (d.dependents as Record<string, unknown>[]) : [];
  return {
    ...EMPTY,
    spouse: d.spouse === true,
    spouseBirthYear: s(d.spouseBirthYear),
    spouseIncome: s(d.spouseIncome),
    dependents: deps.map((x) => ({ name: String(x.name ?? ""), relation: String(x.relation ?? ""), birthYear: s(x.birthYear), income: s(x.income), livingTogether: x.livingTogether === true })),
    ...Object.fromEntries((["lifeGeneral", "lifeMedical", "lifePension", "earthquake", "socialDeclared", "ideco", "housingLoan", "prevPay", "prevSocial", "prevTax"] as const).map((k) => [k, s(d[k])])),
    oldSystemLife: d.oldSystemLife === true,
    note: String(d.note ?? ""),
  };
}

function Yen({ label, hint, value, onChange }: { label: string; hint?: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block text-sm">
      <span className="text-slate-700">{label}</span>
      {hint && <span className="block text-xs text-slate-500">{hint}</span>}
      <span className="mt-1 flex items-center gap-1">
        <input inputMode="numeric" value={value} onChange={(e) => onChange(e.target.value.replace(/[^\d,]/g, ""))} placeholder="0" className={`${box} text-right`} />
        <span className="text-xs text-slate-500">円</span>
      </span>
    </label>
  );
}

export function StaffYearEndForm() {
  const [mine, setMine] = useState<Mine | null>(null);
  const [f, setF] = useState<Form>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [reading, setReading] = useState(false);
  const [readMsg, setReadMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = () =>
    fetch("/api/staff-app/year-end")
      .then((r) => (r.ok ? r.json() : null))
      .then((m: Mine | null) => {
        setMine(m);
        if (m?.submission) setF(fromData(m.submission.data));
      })
      .catch(() => setMine(null));
  useEffect(() => {
    load();
  }, []);
  const set = (k: keyof Form, v: unknown) => setF({ ...f, [k]: v });
  const setDep = (i: number, k: keyof Dependent, v: unknown) => setF({ ...f, dependents: f.dependents.map((d, j) => (j === i ? { ...d, [k]: v } : d)) });
  // 控除証明書の写真から読む: 読めた金額を、いま入っている金額に足す(証明書が何枚あってもよいように)
  async function readCert(file: File) {
    setReading(true);
    setReadMsg(null);
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/staff-app/year-end/read", { method: "POST", body: fd });
    const json = await res.json().catch(() => ({}));
    setReading(false);
    if (!res.ok) return setReadMsg({ ok: false, text: json.error || "読み取れませんでした" });
    const items = (json.items ?? []) as { field: keyof Form; amount: number; oldSystem: boolean }[];
    if (!items.length) return setReadMsg({ ok: false, text: json.note || "読み取れませんでした" });
    const next = { ...f };
    for (const it of items) (next[it.field] as string) = String((Number(String(next[it.field] || "0").replace(/,/g, "")) || 0) + it.amount);
    if (items.some((i) => i.oldSystem)) next.oldSystemLife = true;
    setF(next);
    setReadMsg({ ok: true, text: `${json.issuer ? `${json.issuer}: ` : ""}${items.map((i) => `${CERT_LABEL[i.field] ?? i.field} ${i.amount.toLocaleString()}円`).join("・")}を足しました。${json.note ?? ""}合っているか確かめてください。` });
  }
  async function submit() {
    if (!mine) return;
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/staff-app/year-end", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ year: mine.year, data: { ...f, dependents: f.dependents.map((d) => ({ ...d, birthYear: Number(d.birthYear) })), spouseBirthYear: Number(f.spouseBirthYear) || null } }) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setMsg({ ok: false, text: json.error || "うまくいきませんでした" });
    setMsg({ ok: true, text: "申告を出しました。控除証明書などの紙は総務に渡してください" });
    load();
  }
  if (!mine) return <p className="text-sm text-slate-500">読み込んでいます…</p>;
  const locked = mine.submission?.status === "APPLIED";
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">{mine.year}年分 年末調整の申告</h1>
        <p className="mt-1 text-sm text-slate-600">配偶者・扶養している家族・今年払った保険料などを書いて出してください。控除の区分や金額は総務が確かめます。わからないところは空けたままでかまいません。</p>
      </div>
      {!mine.linked ? (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">労働者名簿とアカウントがまだつながっていないため、出せません。総務に頼んでください。</p>
      ) : (
        <>
          {mine.submission && (
            <p className={`rounded-2xl border p-3 text-sm ${mine.submission.status === "RETURNED" ? "border-rose-200 bg-rose-50 text-rose-800" : "border-slate-200 bg-white text-slate-700"}`}>
              {STATUS[mine.submission.status] ?? mine.submission.status}
              {mine.submission.reply ? `: ${mine.submission.reply}` : ""}
            </p>
          )}
          <fieldset disabled={locked} className="space-y-4">
            <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="font-semibold">配偶者</h2>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={f.spouse} onChange={(e) => set("spouse", e.target.checked)} />
                配偶者がいる(夫・妻)
              </label>
              {f.spouse && (
                <div className="grid grid-cols-2 gap-3">
                  <label className="block text-sm">
                    <span className="text-slate-700">生まれた年(西暦)</span>
                    <input inputMode="numeric" value={f.spouseBirthYear} onChange={(e) => set("spouseBirthYear", e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="1990" className={`${box} mt-1`} />
                  </label>
                  <Yen label="今年の所得の見込み" hint="パートの給料なら、年収から65万円を引いた額" value={f.spouseIncome} onChange={(v) => set("spouseIncome", v)} />
                </div>
              )}
            </section>

            <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="font-semibold">扶養している家族(配偶者のほか)</h2>
              {f.dependents.map((d, i) => (
                <div key={i} className="space-y-2 rounded-xl border border-slate-200 p-3">
                  <div className="grid grid-cols-2 gap-2">
                    <input aria-label="名前" value={d.name} onChange={(e) => setDep(i, "name", e.target.value)} placeholder="名前" className={box} />
                    <input aria-label="続柄" value={d.relation} onChange={(e) => setDep(i, "relation", e.target.value)} placeholder="続柄(子・父・母)" className={box} />
                    <input aria-label="生まれた年" inputMode="numeric" value={d.birthYear} onChange={(e) => setDep(i, "birthYear", e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="生まれた年(西暦)" className={box} />
                    <input aria-label="今年の所得の見込み" inputMode="numeric" value={d.income} onChange={(e) => setDep(i, "income", e.target.value.replace(/[^\d,]/g, ""))} placeholder="所得の見込み(円)" className={box} />
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={d.livingTogether} onChange={(e) => setDep(i, "livingTogether", e.target.checked)} />
                      いっしょに住んでいる
                    </label>
                    <button type="button" onClick={() => set("dependents", f.dependents.filter((_, j) => j !== i))} className="text-xs text-slate-500">
                      消す
                    </button>
                  </div>
                </div>
              ))}
              <button type="button" onClick={() => set("dependents", [...f.dependents, { name: "", relation: "", birthYear: "", income: "", livingTogether: true }])} className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
                + 家族を足す
              </button>
              <p className="text-xs text-slate-500">16歳未満の子も書いてください(住民税の申告に使います)。</p>
            </section>

            <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="font-semibold">今年払った保険料など</h2>
              <p className="text-xs text-slate-500">控除証明書に書いてある「今年払った額(見込み)」を入れてください。証明書は総務に渡してください。</p>
              <label className={`block cursor-pointer rounded-xl border border-dashed border-indigo-300 bg-indigo-50 px-3 py-2 text-center text-sm text-indigo-800 ${reading ? "opacity-50" : ""}`}>
                {reading ? "読み取っています…" : "控除証明書の写真から読み取る(AI)"}
                <input type="file" accept="image/*,application/pdf" capture="environment" className="hidden" disabled={reading} onChange={(e) => (e.target.files?.[0] && readCert(e.target.files[0]), (e.target.value = ""))} />
              </label>
              {readMsg && <p className={`rounded-xl px-3 py-2 text-xs ${readMsg.ok ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}>{readMsg.text}</p>}
              <Yen label="生命保険料(一般)" value={f.lifeGeneral} onChange={(v) => set("lifeGeneral", v)} />
              <Yen label="介護医療保険料" value={f.lifeMedical} onChange={(v) => set("lifeMedical", v)} />
              <Yen label="個人年金保険料" value={f.lifePension} onChange={(v) => set("lifePension", v)} />
              <Yen label="地震保険料" value={f.earthquake} onChange={(v) => set("earthquake", v)} />
              <Yen label="自分で払った国民年金・国民健康保険など" value={f.socialDeclared} onChange={(v) => set("socialDeclared", v)} />
              <Yen label="iDeCo・小規模企業共済" value={f.ideco} onChange={(v) => set("ideco", v)} />
              <Yen label="住宅ローン控除の額" hint="2年目からの人。税務署から届いた控除証明書の金額" value={f.housingLoan} onChange={(v) => set("housingLoan", v)} />
            </section>

            <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="font-semibold">今年ほかの会社でも働いた人</h2>
              <p className="text-xs text-slate-500">前の会社の源泉徴収票の金額を入れて、紙を総務に渡してください。</p>
              <Yen label="支払金額" value={f.prevPay} onChange={(v) => set("prevPay", v)} />
              <Yen label="社会保険料等の金額" value={f.prevSocial} onChange={(v) => set("prevSocial", v)} />
              <Yen label="源泉徴収税額" value={f.prevTax} onChange={(v) => set("prevTax", v)} />
            </section>

            <textarea value={f.note} onChange={(e) => set("note", e.target.value)} rows={2} placeholder="総務に伝えたいこと(なくてもかまいません)" className={box} />
            {!locked && (
              <button onClick={submit} disabled={busy} className="w-full rounded-xl bg-vermilion-600 px-4 py-3 font-semibold text-white disabled:opacity-50">
                {busy ? "出しています…" : mine.submission ? "直して出し直す" : "申告を出す"}
              </button>
            )}
          </fieldset>
          {msg && <p className={`rounded-xl px-3 py-2 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}>{msg.text}</p>}
        </>
      )}
    </div>
  );
}

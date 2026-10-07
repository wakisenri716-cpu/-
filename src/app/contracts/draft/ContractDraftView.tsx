"use client";

import Link from "next/link";
import { useState } from "react";
import type { Article, ContractDraftKind, DraftCheck, DRAFT_KINDS } from "@/lib/contractDrafts";
import { PrintButton } from "@/components/PrintButton";

type Kinds = typeof DRAFT_KINDS;
type Draft = {
  kind: ContractDraftKind;
  title: string;
  preamble: string;
  articles: Article[];
  kou: string;
  otsu: string;
  company: { name: string; address: string | null; representative: string | null };
  counterpartyAddress: string;
  checks: DraftCheck[];
  mode: "claude" | "template";
};
const ORDER: ContractDraftKind[] = ["NDA", "OUTSOURCING", "SALES"];
const LEVEL: Record<DraftCheck["level"], string> = { ng: "border-rose-200 bg-rose-50 text-rose-900", warn: "border-amber-200 bg-amber-50 text-amber-900", info: "border-slate-200 bg-slate-50 text-slate-700" };

export default function ContractDraftView({ kinds, today, ai }: { kinds: Kinds; today: string; ai: boolean }) {
  const [kind, setKind] = useState<ContractDraftKind>("NDA");
  const [f, setF] = useState({ counterparty: "", counterpartyAddress: "", ourRole: "CLIENT", startDate: today, months: "12", autoRenew: true, purpose: "", mutual: true, survivalYears: "3", work: "", fee: "", feeUnit: "MONTHLY", paymentDays: "30", freelancer: false, ipToClient: true, inspectionDays: "7", notes: "" });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [registered, setRegistered] = useState<string | null>(null);
  const set = (patch: Partial<typeof f>) => setF((v) => ({ ...v, ...patch }));

  async function call(url: string, extra: Record<string, unknown>) {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, ...f, ...extra }) });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? "うまくいきませんでした");
    return body;
  }
  async function make(useAi: boolean) {
    setBusy(useAi ? "ai" : "template");
    setError(null);
    setRegistered(null);
    try {
      setDraft(await call("/api/contract-drafts", { useAi }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "うまくいきませんでした");
    } finally {
      setBusy(null);
    }
  }
  async function register() {
    setBusy("register");
    setError(null);
    try {
      const r = await call("/api/contract-drafts/register", {});
      setRegistered(r.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "うまくいきませんでした");
    } finally {
      setBusy(null);
    }
  }

  const input = "mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm";
  const num = "mt-1 w-24 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-right text-sm";
  const check = (key: "autoRenew" | "mutual" | "freelancer" | "ipToClient", label: string) => (
    <label className="inline-flex items-center gap-1.5 text-sm text-slate-700">
      <input type="checkbox" checked={f[key]} onChange={(e) => set({ [key]: e.target.checked })} className="accent-indigo-700" />
      {label}
    </label>
  );
  let n = 0;
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
                setDraft(null);
              }}
              className={`rounded-full border px-4 py-1.5 text-sm ${kind === k ? "border-indigo-700 bg-indigo-700 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
            >
              {kinds[k].title}
            </button>
          ))}
        </div>
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <p className="text-sm text-slate-600">{kinds[kind].description}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="text-slate-700">相手方の名前</span>
              <input value={f.counterparty} onChange={(e) => set({ counterparty: e.target.value })} placeholder="例: 株式会社みどり商事" className={input} />
            </label>
            <label className="block text-sm">
              <span className="text-slate-700">相手方の住所(署名欄に入ります・任意)</span>
              <input value={f.counterpartyAddress} onChange={(e) => set({ counterpartyAddress: e.target.value })} className={input} />
            </label>
            {kind !== "NDA" && (
              <label className="block text-sm">
                <span className="text-slate-700">当社の立場</span>
                <select value={f.ourRole} onChange={(e) => set({ ourRole: e.target.value })} className={input}>
                  <option value="CLIENT">{kind === "OUTSOURCING" ? "仕事を頼む側(甲)" : "買う側(甲)"}</option>
                  <option value="CONTRACTOR">{kind === "OUTSOURCING" ? "仕事を頼まれる側(乙)" : "売る側(乙)"}</option>
                </select>
              </label>
            )}
            <div className="flex flex-wrap items-end gap-3">
              <label className="block text-sm">
                <span className="text-slate-700">開始日</span>
                <input type="date" value={f.startDate} onChange={(e) => set({ startDate: e.target.value })} className={input} />
              </label>
              <label className="block text-sm">
                <span className="text-slate-700">期間(か月)</span>
                <input value={f.months} onChange={(e) => set({ months: e.target.value.replace(/[^\d]/g, "") })} inputMode="numeric" className={num} />
              </label>
              <div className="pb-2">{check("autoRenew", "自動で更新")}</div>
            </div>
            {kind === "NDA" && (
              <>
                <label className="block text-sm sm:col-span-2">
                  <span className="text-slate-700">情報を見せ合う目的</span>
                  <input value={f.purpose} onChange={(e) => set({ purpose: e.target.value })} placeholder="例: 新商品の共同販売の検討" className={input} />
                </label>
                <div className="flex flex-wrap items-end gap-4">
                  {check("mutual", "お互いに秘密を守る(外すと当社が見せる側だけ)")}
                  <label className="block text-sm">
                    <span className="text-slate-700">終わったあとも守る年数</span>
                    <input value={f.survivalYears} onChange={(e) => set({ survivalYears: e.target.value.replace(/[^\d]/g, "") })} inputMode="numeric" className={num} />
                  </label>
                </div>
              </>
            )}
            {kind !== "NDA" && (
              <label className="block text-sm sm:col-span-2">
                <span className="text-slate-700">{kind === "OUTSOURCING" ? "業務の内容" : "取引する商品"}</span>
                <textarea value={f.work} onChange={(e) => set({ work: e.target.value })} rows={2} placeholder={kind === "OUTSOURCING" ? "例: 当社ホームページの更新作業(月4回まで)" : "例: 焼き菓子(個別の品名・数量は注文書で定める)"} className={input} />
              </label>
            )}
            {kind === "OUTSOURCING" && (
              <div className="flex flex-wrap items-end gap-3">
                <label className="block text-sm">
                  <span className="text-slate-700">委託料(税別)</span>
                  <input value={f.fee} onChange={(e) => set({ fee: e.target.value.replace(/[^\d]/g, "") })} inputMode="numeric" className="mt-1 w-32 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-right text-sm" />
                </label>
                <select value={f.feeUnit} onChange={(e) => set({ feeUnit: e.target.value })} aria-label="委託料の単位" className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm">
                  <option value="MONTHLY">月額</option>
                  <option value="ONCE">一括</option>
                </select>
              </div>
            )}
            {kind !== "NDA" && (
              <div className="flex flex-wrap items-end gap-3">
                <label className="block text-sm">
                  <span className="text-slate-700">支払いまでの日数</span>
                  <input value={f.paymentDays} onChange={(e) => set({ paymentDays: e.target.value.replace(/[^\d]/g, "") })} inputMode="numeric" className={num} />
                </label>
                <label className="block text-sm">
                  <span className="text-slate-700">検査の日数</span>
                  <input value={f.inspectionDays} onChange={(e) => set({ inspectionDays: e.target.value.replace(/[^\d]/g, "") })} inputMode="numeric" className={num} />
                </label>
              </div>
            )}
            {kind === "OUTSOURCING" && (
              <div className="flex flex-col gap-2 sm:col-span-2">
                {check("freelancer", "相手はフリーランス(従業員を使わない個人・一人社長)")}
                {check("ipToClient", "成果物の権利を頼む側(甲)に移す")}
              </div>
            )}
            {ai && (
              <label className="block text-sm sm:col-span-2">
                <span className="text-slate-700">AIに伝える事情(任意)</span>
                <textarea value={f.notes} onChange={(e) => set({ notes: e.target.value })} rows={2} placeholder="例: 修正は2回まで無料にしたい。打ち合わせはオンラインで行う。" className={input} />
              </label>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => make(false)} disabled={!!busy} className="rounded-md bg-vermilion-600 px-4 py-2 text-sm font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
              {busy === "template" ? "作っています…" : "ひな形で作る"}
            </button>
            {ai && (
              <button onClick={() => make(true)} disabled={!!busy} className="rounded-md border border-indigo-300 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50">
                {busy === "ai" ? "AIが書いています…" : "AIで事情に合わせて作る"}
              </button>
            )}
          </div>
          {error && <p className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-800">{error}</p>}
        </section>
      </div>

      {draft && (
        <div className="space-y-4">
          <ul className="space-y-2 print:hidden">
            {draft.checks.map((c, i) => (
              <li key={i} className={`rounded-lg border px-3 py-2 text-sm ${LEVEL[c.level]}`}>
                {c.text}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
            <p className="text-sm text-slate-600">{draft.mode === "claude" ? "AIが事情に合わせて直した下書きです。" : "ひな形の下書きです。"}</p>
            <div className="flex flex-wrap items-center gap-2">
              {registered ? (
                <Link href="/contracts" className="text-sm text-emerald-700 hover:underline">
                  台帳に登録しました →
                </Link>
              ) : (
                <button onClick={register} disabled={!!busy} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                  {busy === "register" ? "登録しています…" : "契約書の台帳に登録"}
                </button>
              )}
              <PrintButton variant="outline" />
            </div>
          </div>
          <article className="mx-auto max-w-3xl space-y-4 rounded-xl border border-slate-200 bg-white p-6 text-sm leading-7 shadow-sm sm:p-10 print:max-w-none print:border-0 print:p-0 print:shadow-none">
            <h2 className="text-center text-xl font-semibold tracking-widest">{draft.title}</h2>
            <p>{draft.preamble}</p>
            {draft.articles.map((a, i) => (
              <section key={i}>
                <h3 className="font-semibold">
                  第{++n}条({a.title})
                </h3>
                {a.paragraphs.length > 1 ? (
                  a.paragraphs.map((p, j) => (
                    <p key={j} className="whitespace-pre-wrap">
                      <span className="mr-1">{j + 1}</span>
                      {p}
                    </p>
                  ))
                ) : (
                  <p className="whitespace-pre-wrap">{a.paragraphs[0]}</p>
                )}
              </section>
            ))}
            <p className="pt-2">本契約の成立を証するため、本書2通を作成し、甲乙記名押印のうえ、各1通を保有する。</p>
            <p>{"　　"}年{"　　"}月{"　　"}日</p>
            <div className="grid gap-6 pt-2 sm:grid-cols-2">
              {(
                [
                  ["甲", draft.kou],
                  ["乙", draft.otsu],
                ] as const
              ).map(([label, name]) => {
                const ours = name === draft.company.name;
                return (
                  <div key={label} className="space-y-1">
                    <p className="font-semibold">{label}</p>
                    <p>住所 {ours ? draft.company.address ?? "" : draft.counterpartyAddress}</p>
                    <p>名称 {name}</p>
                    <p>
                      代表者 {ours ? draft.company.representative ?? "" : ""}
                      <span className="ml-8 text-slate-400">印</span>
                    </p>
                  </div>
                );
              })}
            </div>
          </article>
        </div>
      )}
    </div>
  );
}

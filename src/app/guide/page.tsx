import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { GUIDE, type GuideSection } from "@/lib/guide";
import { PrintButton } from "@/components/PrintButton";
import { LegalLinks } from "@/components/LegalLinks";

export const metadata: Metadata = { title: "使い方ガイド | Clerkly" };

const WHO = { 全員: "bg-emerald-100 text-emerald-800", 管理者: "bg-indigo-100 text-indigo-800", 従業員: "bg-sky-100 text-sky-800" } as const;

// 画面の写真。スマホの画面は縦長なので細く、パソコンの画面は横いっぱいに出す
function Shot({ name, title }: { name: string; title: string }) {
  const phone = name.endsWith("-phone");
  return (
    <figure className={phone ? "mx-auto w-52 shrink-0" : "w-full"}>
      <a href={`/guide/${name}.jpg`} target="_blank" rel="noreferrer" title="クリックで大きく表示">
        <Image
          src={`/guide/${name}.jpg`}
          alt={`${title}の画面`}
          width={phone ? 780 : 1040}
          height={phone ? 1688 : 800}
          sizes={phone ? "208px" : "(min-width: 768px) 720px, 100vw"}
          className={`h-auto w-full border border-slate-200 shadow-sm ${phone ? "rounded-2xl" : "rounded-lg"}`}
        />
      </a>
      <figcaption className="mt-1 text-center text-[11px] text-slate-500">{phone ? "スマホの画面" : "赤い枠が押すところです"}</figcaption>
    </figure>
  );
}

function Steps({ steps }: { steps: string[] }) {
  return (
    <ol className="space-y-2 text-sm leading-relaxed">
      {steps.map((step, j) => (
        <li key={j} className="flex gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white">{j + 1}</span>
          <span className="pt-0.5">{step}</span>
        </li>
      ))}
    </ol>
  );
}

// 手順と写真。スマホの写真は手順の横に、パソコンの写真は手順の下に並べる
function SectionBody({ s }: { s: GuideSection }) {
  const phones = (s.images ?? []).filter((n) => n.endsWith("-phone"));
  const pcs = (s.images ?? []).filter((n) => !n.endsWith("-phone"));
  return (
    <div className="mt-3 space-y-4">
      <div className={phones.length ? "flex flex-col gap-4 sm:flex-row sm:items-start" : ""}>
        <div className="min-w-0 flex-1">
          <Steps steps={s.steps} />
        </div>
        {phones.map((n) => (
          <Shot key={n} name={n} title={s.title} />
        ))}
      </div>
      {pcs.map((n) => (
        <Shot key={n} name={n} title={s.title} />
      ))}
    </div>
  );
}

// 使い方ガイドブック(ログインしなくても読める。印刷・PDF保存で1冊の冊子になる)
export default function GuidePage() {
  return (
    <div className="mx-auto max-w-3xl space-y-8 py-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-wide text-indigo-700">Clerkly(クラークリー)</p>
          <h1 className="mt-1 text-2xl font-bold sm:text-3xl">使い方ガイドブック</h1>
          <p className="mt-2 text-sm text-slate-600">
            登録から、毎日の経費・請求、毎月の給与と締め、年に1回の決算まで、仕事の流れにそって使い方をまとめました。画面の写真の<span className="font-semibold text-rose-600">赤い枠</span>が、押すところです(写真はクリックすると大きく見られます)。「印刷・PDF」で1冊の冊子として保存できます。
          </p>
        </div>
        <div className="print:hidden">
          <PrintButton variant="outline" />
        </div>
      </div>

      <nav className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm print:break-after-page print:border-0 print:shadow-none" aria-label="目次">
        <h2 className="font-semibold">目次</h2>
        <ol className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {GUIDE.map((c, i) => (
            <li key={c.id}>
              <a href={`#${c.id}`} className="font-medium text-indigo-700 hover:underline">
                {i + 1}. {c.title}
              </a>
              <span className="block text-xs text-slate-500">{c.sections.map((s) => s.title).join("・")}</span>
            </li>
          ))}
        </ol>
      </nav>

      {GUIDE.map((c, i) => (
        <section key={c.id} id={c.id} className="scroll-mt-4 space-y-4 print:break-before-page">
          <div className="border-b-2 border-indigo-600 pb-2">
            <h2 className="text-xl font-bold">
              第{i + 1}章 {c.title}
            </h2>
            <p className="mt-1 text-sm text-slate-600">{c.lead}</p>
          </div>
          {c.sections.map((s) => (
            <article key={s.title} className="break-inside-avoid rounded-xl border border-slate-200 bg-white p-4 shadow-sm print:shadow-none">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold">
                  {s.title}
                  <span className={`ml-2 rounded-full px-2 py-0.5 align-middle text-[11px] font-medium ${WHO[s.who ?? "管理者"] ?? ""}`}>
                    {s.who === "全員" ? "全員" : s.who === "従業員" ? "従業員" : s.who === "管理者" ? "管理者" : "管理者・経理担当"}
                  </span>
                </h3>
                {s.href && (
                  <Link href={s.href} className="text-xs font-medium text-indigo-700 hover:underline print:hidden">
                    画面を開く →
                  </Link>
                )}
              </div>
              <SectionBody s={s} />
              {s.tips && (
                <ul className="mt-3 space-y-1 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  {s.tips.map((t) => (
                    <li key={t}>ポイント: {t}</li>
                  ))}
                </ul>
              )}
            </article>
          ))}
        </section>
      ))}

      <p className="text-center text-xs text-slate-500">ご不明な点は、会社の管理者にお問い合わせください。</p>
      <LegalLinks />
    </div>
  );
}

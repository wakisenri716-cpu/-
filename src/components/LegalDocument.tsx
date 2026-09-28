import type { ReactNode } from "react";
import Link from "next/link";
import { PrintButton } from "@/components/PrintButton";
import { LegalLinks } from "@/components/LegalLinks";

// 利用規約・プライバシーポリシーの共通レイアウト(印刷・PDF保存もできる)
export function LegalDocument({ title, effective, children }: { title: string; effective: string; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl py-6">
      <div className="mb-4 flex items-center justify-between gap-3 print:hidden">
        <Link href="/" className="text-sm text-indigo-700 hover:underline">
          ← 経理オートメーション
        </Link>
        <PrintButton variant="outline" />
      </div>
      <article className="legal space-y-4 rounded-xl border border-slate-200 bg-white p-5 text-sm leading-relaxed shadow-sm sm:p-8 print:border-0 print:p-0 print:shadow-none">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="text-xs text-slate-500">制定日: {effective}</p>
        {children}
      </article>
      <LegalLinks />
    </div>
  );
}

export function Article({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="pt-2 text-base font-semibold">
        第{n}条({title})
      </h2>
      <div className="space-y-2 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-6 [&_a]:text-indigo-700 [&_a]:underline">{children}</div>
    </section>
  );
}

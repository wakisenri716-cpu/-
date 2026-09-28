import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCompanyId, requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { addressee, getParty } from "@/lib/addressBook";
import { jstDateKey } from "@/lib/jst";
import { PrintButton } from "@/components/PrintButton";

export const dynamic = "force-dynamic";

type Params = { kind?: string; id?: string; items?: string; title?: string; date?: string; note?: string; sender?: string };

function jpDate(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return `${y}年${m}月${d}日`;
}

// 送付状(書類に添える案内状)。上の欄で送る書類・日付・備考を変えて、A4で印刷する
export default async function CoverLetterPage({ searchParams }: { searchParams: Promise<Params> }) {
  const companyId = await requireCompanyId();
  const user = await requireUser();
  const sp = await searchParams;
  if (sp.kind !== "customer" && sp.kind !== "vendor") notFound();
  const [party, company] = await Promise.all([getParty(companyId, sp.kind, String(sp.id ?? "")), prisma.company.findUniqueOrThrow({ where: { id: companyId } })]);
  if (!party) notFound();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : jstDateKey(new Date());
  const items = (sp.items ?? "請求書 1通").split(/\r?\n/).map((s) => s.trim()).filter(Boolean).slice(0, 15);
  const title = (sp.title ?? "").trim() || "書類送付のご案内";
  const note = (sp.note ?? "").trim();
  const sender = (sp.sender ?? "").trim() || user.name;
  const to = addressee(party);
  const inputClass = "mt-1 w-full rounded-md border px-2 py-1.5 text-sm";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link href="/letters" className="text-sm text-indigo-700 hover:underline">
          ← 宛名・送付状
        </Link>
        <PrintButton />
      </div>

      <form className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm sm:grid-cols-2 print:hidden">
        <input type="hidden" name="kind" value={sp.kind} />
        <input type="hidden" name="id" value={party.id} />
        <label className="block">
          <span className="text-slate-600">日付</span>
          <input type="date" name="date" defaultValue={date} className={inputClass} />
        </label>
        <label className="block">
          <span className="text-slate-600">件名</span>
          <input name="title" defaultValue={title} maxLength={40} className={inputClass} />
        </label>
        <label className="block">
          <span className="text-slate-600">送る書類(1行に1つ)</span>
          <textarea name="items" rows={3} defaultValue={items.join("\n")} className={inputClass} />
        </label>
        <div className="space-y-3">
          <label className="block">
            <span className="text-slate-600">担当者(送る人)</span>
            <input name="sender" defaultValue={sender} maxLength={40} className={inputClass} />
          </label>
          <label className="block">
            <span className="text-slate-600">備考(任意)</span>
            <input name="note" defaultValue={note} maxLength={200} placeholder="例: ご不明な点はお気軽にお問い合わせください。" className={inputClass} />
          </label>
        </div>
        <div className="sm:col-span-2">
          <button className="rounded-md border border-slate-300 px-4 py-1.5 hover:bg-slate-50">この内容で作り直す</button>
          {!party.address && <span className="ml-3 text-xs text-amber-700">相手の住所が未入力です。「宛名・送付状」で入れると、宛先に住所が入ります。</span>}
        </div>
      </form>

      <article className="mx-auto max-w-[210mm] bg-white p-8 text-[13.5px] leading-relaxed text-slate-900 shadow-sm ring-1 ring-slate-200 sm:p-[20mm] print:max-w-none print:p-0 print:shadow-none print:ring-0">
        <p className="text-right">{jpDate(date)}</p>
        <div className="mt-6">
          {party.postalCode && <p>〒{party.postalCode}</p>}
          {party.address && <p>{party.address}</p>}
          <div className="mt-2 text-base">
            {to.lines.map((l) => (
              <p key={l}>{l}</p>
            ))}
            <p className="text-lg font-semibold">{to.main}</p>
          </div>
        </div>
        <div className="mt-6 text-right text-sm">
          <p className="font-semibold">{company.name}</p>
          {company.address && <p>{company.address}</p>}
          {company.phone && <p>TEL: {company.phone}</p>}
          <p>担当: {sender}</p>
        </div>
        <h1 className="mt-10 text-center text-xl font-bold tracking-widest">{title}</h1>
        <div className="mt-8 space-y-3">
          <p>拝啓 時下ますますご清栄のこととお慶び申し上げます。平素は格別のお引き立てを賜り、厚く御礼申し上げます。</p>
          <p>さて、下記の書類をお送りいたしますので、ご査収くださいますようお願い申し上げます。</p>
          <p className="text-right">敬具</p>
        </div>
        <p className="mt-8 text-center">記</p>
        <ul className="mx-auto mt-4 w-fit min-w-[50%] space-y-1">
          {items.map((i) => (
            <li key={i}>・{i}</li>
          ))}
        </ul>
        {note && <p className="mt-8">{note}</p>}
        <p className="mt-8 text-right">以上</p>
      </article>
    </div>
  );
}

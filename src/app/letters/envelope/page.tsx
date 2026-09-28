import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCompanyId } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { addressee, getParty } from "@/lib/addressBook";
import { PrintButton } from "@/components/PrintButton";

export const dynamic = "force-dynamic";

// 縦書き用に、英数字を全角に、ハイフンを「ー」にする(2-2-2 → ２ー２ー２)
function toVertical(text: string | null) {
  return (text ?? "").replace(/[-‐−]/g, "ー").replace(/[0-9A-Za-z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0));
}

// 封筒は明朝体で(縦書きの字の並びが正しく出る日本語フォントを先に指定する)
const MINCHO = '"Yu Mincho", "YuMincho", "Hiragino Mincho ProN", "Noto Serif JP", "IPAMincho", "IPAexMincho", "IPAGothic", serif';

// 封筒(長形3号 120×235mm)の表書き。縦書きで、郵便番号の枠・住所・宛名・差出人・「◯◯在中」を印刷する
export default async function EnvelopePage({ searchParams }: { searchParams: Promise<{ kind?: string; id?: string; stamp?: string }> }) {
  const companyId = await requireCompanyId();
  const sp = await searchParams;
  if (sp.kind !== "customer" && sp.kind !== "vendor") notFound();
  const [party, company] = await Promise.all([getParty(companyId, sp.kind, String(sp.id ?? "")), prisma.company.findUniqueOrThrow({ where: { id: companyId } })]);
  if (!party) notFound();
  const to = addressee(party);
  const stamp = (sp.stamp ?? "請求書在中").slice(0, 10);
  const digits = (party.postalCode ?? "").replace("-", "").padEnd(7, " ").split("");
  const vertical = { writingMode: "vertical-rl" as const, textOrientation: "upright" as const, fontFamily: MINCHO };

  return (
    <div className="space-y-4">
      <style>{"@media print { @page { size: 120mm 235mm; margin: 0 } }"}</style>
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link href="/letters" className="text-sm text-indigo-700 hover:underline">
          ← 宛名・送付状
        </Link>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <form className="flex items-center gap-2">
            <input type="hidden" name="kind" value={sp.kind} />
            <input type="hidden" name="id" value={party.id} />
            <label className="text-slate-600">
              朱書き
              <select name="stamp" defaultValue={stamp} className="ml-1 rounded-md border px-2 py-1">
                {["請求書在中", "見積書在中", "注文書在中", "書類在中", "親展", ""].map((s) => (
                  <option key={s} value={s}>
                    {s || "なし"}
                  </option>
                ))}
              </select>
            </label>
            <button className="rounded-md border px-3 py-1 hover:bg-slate-50">変える</button>
          </form>
          <PrintButton />
        </div>
      </div>
      <p className="text-xs text-slate-500 print:hidden">印刷するときは、用紙を「長形3号(120×235mm)」、余白を「なし」にしてください。</p>

      <div className="flex justify-center overflow-x-auto print:block">
        <div className="relative shrink-0 bg-white text-slate-900 shadow ring-1 ring-slate-200 print:shadow-none print:ring-0" style={{ width: "120mm", height: "235mm" }}>
          {/* 郵便番号の枠(右上) */}
          <div className="absolute flex gap-[1.5mm]" style={{ top: "12mm", right: "8mm" }}>
            {digits.map((d, i) => (
              <span key={i} className={`flex items-center justify-center border border-rose-400 font-mono text-[15px] ${i === 3 ? "ml-[1.5mm]" : ""}`} style={{ width: "5.7mm", height: "8mm" }}>
                {d.trim()}
              </span>
            ))}
          </div>
          {/* 住所(右)。縦書きでは段落が右から左へ並ぶので、長い住所は2行目が左に続く */}
          <div className="absolute text-[15px] leading-[1.6] tracking-wider" style={{ ...vertical, top: "30mm", right: "10mm", height: "150mm" }}>
            {toVertical(party.address)}
          </div>
          {/* 会社名・部署・宛名(中央) */}
          <div className="absolute" style={{ ...vertical, top: "42mm", right: "30mm", height: "175mm" }}>
            {to.lines.map((l) => (
              <p key={l} className="ml-[3mm] text-[17px] tracking-widest">
                {l}
              </p>
            ))}
            <p className="text-[26px] font-semibold tracking-[0.3em]">{to.main}</p>
          </div>
          {/* 朱書き(左上) */}
          {stamp && (
            <div className="absolute border-2 border-rose-600 px-[1.5mm] py-[2.5mm] text-[15px] font-bold tracking-[0.3em] whitespace-nowrap text-rose-600" style={{ ...vertical, top: "24mm", left: "10mm" }}>
              {stamp}
            </div>
          )}
          {/* 差出人(左下) */}
          <div className="absolute text-[10.5px] leading-[1.5]" style={{ ...vertical, bottom: "12mm", left: "8mm", height: "100mm" }}>
            {company.address && <p className="ml-[1.5mm]">{toVertical(company.address)}</p>}
            <p className="ml-[1.5mm] text-[13px] font-semibold">{company.name}</p>
            {company.phone && <p>電話 {toVertical(company.phone)}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

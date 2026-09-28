import Link from "next/link";
import { requireCompanyId } from "@/lib/auth/session";
import { addressee, partiesFromKeys } from "@/lib/addressBook";
import { PrintButton } from "@/components/PrintButton";

export const dynamic = "force-dynamic";

// 宛名ラベル(A4 12面: 86.4×42.3mm を 2列×6段)。12件を超えると次のページに続く
export default async function LabelsPage({ searchParams }: { searchParams: Promise<{ keys?: string; skip?: string }> }) {
  const companyId = await requireCompanyId();
  const sp = await searchParams;
  const parties = (await partiesFromKeys(companyId, sp.keys ?? "")).filter((p) => p.address);
  // 使いかけのシートのために、先頭の何枚かを空けられる
  const skip = Math.min(11, Math.max(0, Number(sp.skip) || 0));
  const cells = [...Array(skip).fill(null), ...parties];
  const pages: (typeof cells)[] = [];
  for (let i = 0; i < cells.length; i += 12) pages.push(cells.slice(i, i + 12));

  return (
    <div className="space-y-4">
      <style>{"@media print { @page { size: A4; margin: 0 } }"}</style>
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link href="/letters" className="text-sm text-indigo-700 hover:underline">
          ← 宛名・送付状
        </Link>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <form className="flex items-center gap-2">
            <input type="hidden" name="keys" value={sp.keys ?? ""} />
            <label className="text-slate-600">
              先頭を空ける枚数
              <input type="number" name="skip" min={0} max={11} defaultValue={skip} className="ml-1 w-16 rounded-md border px-2 py-1" />
            </label>
            <button className="rounded-md border px-3 py-1 hover:bg-slate-50">変える</button>
          </form>
          <PrintButton />
        </div>
      </div>
      <p className="text-xs text-slate-500 print:hidden">
        {parties.length}件を印刷します(住所のない相手は除いています)。A4 12面(86.4×42.3mm)のラベル用紙に、余白「なし」・倍率100%で印刷してください。
      </p>

      <div className="space-y-6 overflow-x-auto print:space-y-0">
        {pages.map((cellsOnPage, p) => (
          <div
            key={p}
            className="relative mx-auto bg-white shadow ring-1 ring-slate-200 print:break-after-page print:shadow-none print:ring-0"
            style={{ width: "210mm", height: "297mm", padding: "21.5mm 18.6mm" }}
          >
            <div className="grid grid-cols-2" style={{ gridAutoRows: "42.3mm" }}>
              {cellsOnPage.map((party, i) => {
                if (!party) return <div key={`blank-${i}`} className="border border-dashed border-slate-200 print:border-0" />;
                const to = addressee(party);
                return (
                  <div key={party.id} className="overflow-hidden border border-dashed border-slate-200 px-[6mm] py-[4mm] text-[11px] leading-snug print:border-0" style={{ width: "86.4mm" }}>
                    <p>〒{party.postalCode}</p>
                    <p>{party.address}</p>
                    <div className="mt-[2mm]">
                      {to.lines.map((l) => (
                        <p key={l} className="text-[12px]">
                          {l}
                        </p>
                      ))}
                      <p className="text-[14px] font-semibold">{to.main}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        {parties.length === 0 && <p className="text-center text-sm text-slate-400">住所のある相手が選ばれていません。</p>}
      </div>
    </div>
  );
}

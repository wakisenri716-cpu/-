import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireCompanyId } from "@/lib/auth/session";
import { getStatements } from "@/lib/withholding/service";
import { PrintButton } from "@/components/PrintButton";

export const dynamic = "force-dynamic";

const yen = (n: number) => n.toLocaleString("ja-JP");

// 報酬、料金、契約金及び賞金の支払調書(1人分)。税務署に出す控えや、相手に渡す写しとして印刷する
export default async function StatementPage({ searchParams }: { searchParams: Promise<{ year?: string; vendorId?: string }> }) {
  const companyId = await requireCompanyId();
  const { year, vendorId } = await searchParams;
  if (!year || !vendorId) notFound();
  const [statements, company] = await Promise.all([
    getStatements(companyId, year).catch(() => null),
    prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { name: true, address: true, phone: true } }),
  ]);
  const row = statements?.fees.find((f) => f.vendorId === vendorId);
  if (!row) notFound();
  const cell = "border border-slate-500 px-2 py-1.5";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 print:hidden">
        <Link href="/withholding" className="text-sm text-indigo-700 hover:underline">
          ← 源泉徴収・納付
        </Link>
        <PrintButton />
      </div>
      <article className="mx-auto max-w-[210mm] bg-white p-5 text-[13px] text-slate-900 shadow-sm ring-1 ring-slate-200 sm:p-10 print:max-w-none print:p-0 print:shadow-none print:ring-0">
        <h1 className="text-center text-lg font-bold tracking-wide">{statements!.year}年分 報酬、料金、契約金及び賞金の支払調書</h1>
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[32rem] border-collapse">
            <tbody>
              <tr>
                <th rowSpan={2} className={`${cell} w-24 bg-slate-50 print:bg-slate-100`}>
                  支払を
                  <br />
                  受ける者
                </th>
                <th className={`${cell} w-24 bg-slate-50 font-normal print:bg-slate-100`}>住所(居所)</th>
                <td className={cell} colSpan={3}>
                  {row.address ?? ""}
                </td>
              </tr>
              <tr>
                <th className={`${cell} bg-slate-50 font-normal print:bg-slate-100`}>氏名又は名称</th>
                <td className={cell} colSpan={3}>
                  {row.name}
                </td>
              </tr>
              <tr className="bg-slate-50 text-center print:bg-slate-100">
                <th className={cell} colSpan={2}>
                  区分
                </th>
                <th className={cell}>細目</th>
                <th className={cell}>支払金額</th>
                <th className={cell}>源泉徴収税額</th>
              </tr>
              <tr>
                <td className={cell} colSpan={2}>
                  {row.categories.join("・")}
                </td>
                <td className={cell}>{row.count}回分</td>
                <td className={`${cell} text-right tabular-nums`}>{yen(row.base)}円</td>
                <td className={`${cell} text-right tabular-nums`}>{yen(row.tax)}円</td>
              </tr>
              <tr>
                <th className={`${cell} bg-slate-50 print:bg-slate-100`} rowSpan={2}>
                  支払者
                </th>
                <th className={`${cell} bg-slate-50 font-normal print:bg-slate-100`}>住所(所在地)</th>
                <td className={cell} colSpan={3}>
                  {company.address ?? ""}
                  {company.phone ? `(電話 ${company.phone})` : ""}
                </td>
              </tr>
              <tr>
                <th className={`${cell} bg-slate-50 font-normal print:bg-slate-100`}>氏名又は名称</th>
                <td className={cell} colSpan={3}>
                  {company.name}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-[11px] text-slate-500">
          ※ 個人番号・法人番号の欄は、この控えには載せていません。税務署に出すときは、国税庁の様式(e-Tax・eLTAX・紙)に番号を加えて出してください。
        </p>
      </article>
    </div>
  );
}

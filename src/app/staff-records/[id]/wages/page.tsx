import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCompanyId } from "@/lib/auth/session";
import { getWageLedger, type LedgerColumn } from "@/lib/staffRecords";
import { UserError } from "@/lib/errors";
import { PrintButton } from "@/components/PrintButton";

export const dynamic = "force-dynamic";

const hm = (m: number | null) => (m === null ? "" : `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`);
const yen = (n: number) => (n ? n.toLocaleString("ja-JP") : "");

const ROWS: [string, (c: LedgerColumn) => string, boolean?][] = [
  ["労働日数", (c) => (c.days === null ? "" : `${c.days}日`)],
  ["労働時間数", (c) => hm(c.workMinutes)],
  ["時間外労働時間数", (c) => hm(c.overtimeMinutes)],
  ["深夜労働時間数", (c) => hm(c.nightMinutes)],
  ["基本給(時給×時間)", (c) => yen(c.basePay)],
  ["時間外割増", (c) => yen(c.overtimePay)],
  ["深夜割増", (c) => yen(c.nightPay)],
  ["有給休暇の賃金", (c) => yen(c.leavePay)],
  ["賞与", (c) => yen(c.bonus)],
  ["通勤手当", (c) => yen(c.commute)],
  ["総支給額", (c) => yen(c.gross), true],
  ["健康保険料", (c) => yen(c.health)],
  ["介護保険料", (c) => yen(c.care)],
  ["厚生年金保険料", (c) => yen(c.pension)],
  ["雇用保険料", (c) => yen(c.employment)],
  ["所得税", (c) => yen(c.incomeTax)],
  ["住民税", (c) => yen(c.residentTax)],
  ["控除合計", (c) => yen(c.totalDeductions), true],
  ["差引支給額", (c) => yen(c.netPay), true],
];

// 賃金台帳(労働基準法108条)。計上した給料(働いた月)と賞与を月ごとの列に並べる
export default async function WageLedgerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ year?: string }> }) {
  const { id } = await params;
  const { year } = await searchParams;
  const companyId = await requireCompanyId();
  const ledger = await getWageLedger(companyId, id, year ?? new Date().getFullYear()).catch((e) => {
    if (e instanceof UserError) return null;
    throw e;
  });
  if (!ledger) notFound();
  const cols = [...ledger.columns, ledger.total];
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 print:hidden">
        <Link href="/staff-records" className="text-sm text-indigo-700 hover:underline">
          ← 労働者名簿・賃金台帳
        </Link>
        <PrintButton />
      </div>
      <article className="bg-white p-4 text-[11.5px] text-slate-900 shadow-sm ring-1 ring-slate-200 sm:p-8 print:p-0 print:shadow-none print:ring-0">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h1 className="text-xl font-bold tracking-widest">賃金台帳 {ledger.year}年</h1>
          <p>
            {ledger.staff.name}(時給 {ledger.staff.hourlyWage.toLocaleString("ja-JP")}円)
          </p>
        </div>
        {ledger.columns.length === 0 ? (
          <p className="mt-6 text-slate-500">{ledger.year}年に計上した給料・賞与はありません。</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="border border-slate-400 bg-slate-50 px-2 py-1.5 text-left print:bg-slate-100">項目</th>
                  {cols.map((c, i) => (
                    <th key={i} className="border border-slate-400 bg-slate-50 px-2 py-1.5 text-right whitespace-nowrap print:bg-slate-100">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ROWS.map(([label, get, strong]) => (
                  <tr key={label} className={strong ? "font-semibold" : ""}>
                    <th className="border border-slate-400 px-2 py-1 text-left font-medium whitespace-nowrap">{label}</th>
                    {cols.map((c, i) => (
                      <td key={i} className="border border-slate-400 px-2 py-1 text-right whitespace-nowrap tabular-nums">
                        {get(c)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-[11px] text-slate-500">※ 賃金台帳は、最後に記入した日から5年間(当分の間は3年間)保存します。時間は「時間:分」。</p>
      </article>
    </div>
  );
}

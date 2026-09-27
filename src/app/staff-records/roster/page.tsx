import Link from "next/link";
import { requireCompanyId } from "@/lib/auth/session";
import { EMPLOYMENT_TYPES, getStaffRecords } from "@/lib/staffRecords";
import { PrintButton } from "@/components/PrintButton";

export const dynamic = "force-dynamic";

const jp = (k?: string | null) => {
  if (!k) return "";
  const [y, m, d] = k.split("-").map(Number);
  return `${y}年${m}月${d}日`;
};

// 労働者名簿(労働基準法107条)。退職した人も3年間は残す
export default async function RosterPage() {
  const companyId = await requireCompanyId();
  const { company, staff } = await getStaffRecords(companyId);
  const th = "border border-slate-400 bg-slate-50 px-2 py-1.5 text-left font-medium print:bg-slate-100";
  const td = "border border-slate-400 px-2 py-1.5 align-top";
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 print:hidden">
        <Link href="/staff-records" className="text-sm text-indigo-700 hover:underline">
          ← 労働者名簿・賃金台帳
        </Link>
        <PrintButton />
      </div>
      <article className="bg-white p-4 text-[12px] text-slate-900 shadow-sm ring-1 ring-slate-200 sm:p-8 print:p-0 print:shadow-none print:ring-0">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h1 className="text-xl font-bold tracking-widest">労働者名簿</h1>
          <p>{company.name}</p>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[56rem] border-collapse">
            <thead>
              <tr>
                {["氏名(ふりがな)", "生年月日", "性別", "住所", "従事する業務", "雇用形態", "雇入れ年月日", "退職年月日・事由"].map((h) => (
                  <th key={h} className={th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {staff.map((s) => (
                <tr key={s.id}>
                  <td className={td}>
                    <div className="font-medium">{s.name}</div>
                    <div className="text-[11px] text-slate-500">{s.profile.kana ?? ""}</div>
                  </td>
                  <td className={td}>{jp(s.profile.birthDate)}</td>
                  <td className={td}>{s.profile.gender ?? ""}</td>
                  <td className={td}>{s.profile.address ?? ""}</td>
                  <td className={td}>{s.profile.job ?? ""}</td>
                  <td className={td}>{s.profile.employmentType ? EMPLOYMENT_TYPES[s.profile.employmentType] : ""}</td>
                  <td className={td}>{jp(s.hireDate)}</td>
                  <td className={td}>
                    {jp(s.profile.retireDate)}
                    {s.profile.retireReason && <div>{s.profile.retireReason}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[11px] text-slate-500">※ 労働者名簿は、退職した日から3年間(当分の間)保存します。</p>
      </article>
    </div>
  );
}

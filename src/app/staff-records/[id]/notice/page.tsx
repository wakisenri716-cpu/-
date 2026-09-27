import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCompanyId } from "@/lib/auth/session";
import { EMPLOYMENT_TYPES, getStaffRecord } from "@/lib/staffRecords";
import { grantDays } from "@/lib/leave/rules";
import { PrintButton } from "@/components/PrintButton";

export const dynamic = "force-dynamic";

const jp = (k?: string | null) => {
  if (!k) return "";
  const [y, m, d] = k.split("-").map(Number);
  return `${y}年${m}月${d}日`;
};

// 労働条件通知書(労働基準法15条・厚生労働省のモデル様式をもとにした簡易版)
export default async function NoticePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  const data = await getStaffRecord(companyId, id);
  if (!data) notFound();
  const { company, defaults: d, person: s } = data;
  const p = s.profile;
  const today = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", dateStyle: "long" }).format(new Date());
  const rows: [string, React.ReactNode][] = [
    ["契約期間", p.contractEnd ? `期間の定めあり(${jp(s.hireDate)}〜${jp(p.contractEnd)})` : `期間の定めなし(${jp(s.hireDate) || "雇入れ日"}から)`],
    ...(p.contractEnd ? ([["契約の更新", p.renewal ?? "更新する場合があり得る"]] as [string, React.ReactNode][]) : []),
    ["就業の場所", p.workplace ?? d.workplace ?? ""],
    ["従事すべき業務の内容", p.job ?? ""],
    [
      "始業・終業の時刻、休憩時間",
      <>
        {p.workStart && p.workEnd ? `始業 ${p.workStart} 終業 ${p.workEnd}` : "シフトによる(個別のシフト表で定める)"}
        {p.breakMinutes !== undefined && `、休憩 ${p.breakMinutes}分`}
        <br />
        1日の所定労働時間 {Math.floor(s.scheduledMinutes / 60)}時間{s.scheduledMinutes % 60 ? `${s.scheduledMinutes % 60}分` : ""}、{p.workDays ?? `週${s.weeklyDays}日`}
      </>,
    ],
    ["所定時間外労働の有無", "有(1日8時間・週40時間を超える労働は、36協定の範囲内で行う)"],
    ["休日", p.holidays ?? d.holidays ?? ""],
    ["休暇", `年次有給休暇: 6か月継続勤務し、出勤率が8割以上の場合 ${grantDays(s.weeklyDays, 0)}日(以後は法定どおり付与)`],
    [
      "賃金",
      <>
        基本給: 時給 {s.hourlyWage.toLocaleString("ja-JP")}円
        {s.commuteAllowance > 0 && `、通勤手当 月${s.commuteAllowance.toLocaleString("ja-JP")}円`}
        <br />
        割増賃金率: 法定時間外 25%、法定休日 35%、深夜(22時〜5時) 25%
        <br />
        締切日: {d.closingDay ?? ""} ・ 支払日: {d.payDay ?? ""} ・ 支払方法: {d.payMethod ?? ""}
        <br />
        賃金支払時の控除: 所得税・住民税・社会保険料・雇用保険料
      </>,
    ],
    ["退職に関する事項", d.retirement ?? "自己都合退職の手続き: 退職する日の14日以上前に届け出ること"],
    ["社会保険の加入状況", `${s.socialInsurance ? "健康保険・厚生年金" : "健康保険・厚生年金(加入なし)"} ・ 雇用保険 ${s.employmentInsurance ? "加入" : "加入なし"}`],
    ["雇用管理の改善等に関する相談窓口", d.consultation ?? ""],
  ];
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 print:hidden">
        <Link href="/staff-records" className="text-sm text-indigo-700 hover:underline">
          ← 労働者名簿・賃金台帳
        </Link>
        <PrintButton />
      </div>
      <article className="mx-auto max-w-[210mm] bg-white p-5 text-[12.5px] leading-relaxed text-slate-900 shadow-sm ring-1 ring-slate-200 sm:p-10 print:max-w-none print:p-0 print:shadow-none print:ring-0">
        <h1 className="text-center text-xl font-bold tracking-widest">労働条件通知書</h1>
        <div className="mt-4 flex flex-wrap justify-between gap-2">
          <p>
            {s.name} 殿{p.employmentType ? `(${EMPLOYMENT_TYPES[p.employmentType]})` : ""}
          </p>
          <div className="text-right">
            <p>{today}</p>
            <p>事業場名称・所在地 {company.name} {company.address ?? ""}</p>
          </div>
        </div>
        <table className="mt-4 w-full border-collapse">
          <tbody>
            {rows.map(([label, value]) => (
              <tr key={label}>
                <th className="w-40 border border-slate-400 bg-slate-50 px-2 py-2 text-left align-top font-medium print:bg-slate-100">{label}</th>
                <td className="border border-slate-400 px-2 py-2">{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-[11px] text-slate-500">
          ※ 以上のほかは、当社の就業規則によります。この通知書は労働基準法第15条に基づくもので、厚生労働省のモデル様式をもとに簡略化しています。
        </p>
        <div className="mt-8 grid grid-cols-2 gap-8 text-[12px]">
          <div className="border-t border-slate-400 pt-1">事業主 {company.name}</div>
          <div className="border-t border-slate-400 pt-1">受け取った日・署名</div>
        </div>
      </article>
    </div>
  );
}

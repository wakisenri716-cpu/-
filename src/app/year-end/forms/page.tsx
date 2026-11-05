import { requireCompanyId } from "@/lib/auth/session";
import { parseYear } from "@/lib/payroll/yearEnd";
import { listYearEndForms } from "@/lib/yearEndForms";
import FormsView from "./FormsView";

export const dynamic = "force-dynamic";

export default async function YearEndFormsPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const companyId = await requireCompanyId();
  const { year } = await searchParams;
  let y: number;
  try {
    y = parseYear(year);
  } catch {
    y = parseYear(undefined);
  }
  const data = await listYearEndForms(companyId, y);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">年末調整の申告(従業員から集める)</h1>
        <p className="mt-1 text-sm text-slate-600">
          従業員はスマホの「年末調整の申告」から、配偶者・扶養している家族(続柄・生まれた年・所得の見込み)・払った保険料・iDeCo・住宅ローン控除・前の勤め先の分を出せます。届いた申告は、扶養の区分と控除額(目安)に直して見せます。確かめて「年末調整に入れる」を押すと、年末調整の入力に入ります。控除証明書などの紙は、本人から受け取ってください。
        </p>
      </div>
      <FormsView initial={JSON.parse(JSON.stringify(data))} />
    </div>
  );
}

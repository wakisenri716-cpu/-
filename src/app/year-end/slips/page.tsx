import Link from "next/link";
import type { ReactNode } from "react";
import { requireCompanyId } from "@/lib/auth/session";
import { getSlips, parseYear } from "@/lib/payroll/yearEnd";
import { PrintButton } from "@/components/PrintButton";

export const dynamic = "force-dynamic";

type Slip = Awaited<ReturnType<typeof getSlips>>["slips"][number];

const num = (v: number | null) => (v === null ? "" : v.toLocaleString("ja-JP"));
const wareki = (date: string) => {
  if (!date) return "";
  const [y, m, d] = date.split("-").map(Number);
  return y >= 2019 ? `令和${y - 2018 === 1 ? "元" : y - 2018}年${m}月${d}日` : y >= 1989 ? `平成${y - 1988 === 1 ? "元" : y - 1988}年${m}月${d}日` : `昭和${y - 1925}年${m}月${d}日`;
};

function Box({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`border border-slate-500 ${className}`}>
      <p className="border-b border-slate-400 bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-600 print:bg-white">{label}</p>
      <div className="min-h-7 px-1.5 py-1 text-right text-sm tabular-nums">{children}</div>
    </div>
  );
}

function SlipView({ slip, year, company }: { slip: Slip; year: number; company: Awaited<ReturnType<typeof getSlips>>["company"] }) {
  const notes = [
    !slip.adjusted && (slip.otsu ? "乙欄適用" : slip.pending ? "年末調整未済(確定前)" : "年末調整未済"),
    slip.prev && `前職分 支払金額${num(slip.prev.pay)}円・社会保険料${num(slip.prev.social)}円・源泉徴収税額${num(slip.prev.tax)}円`,
  ].filter(Boolean);
  const spouseMark = slip.spouse === "none" ? "" : slip.spouse === "elderly" ? "有(老人)" : "有";
  return (
    <article className="mx-auto max-w-3xl space-y-2 rounded-xl border border-slate-200 bg-white p-5 shadow-sm print:break-after-page print:rounded-none print:border-0 print:p-0 print:shadow-none">
      <h2 className="text-center text-lg font-semibold tracking-widest">
        令和{year - 2018}年分　給与所得の源泉徴収票
      </h2>
      <div className="grid gap-0 sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="border border-slate-500 p-1.5 text-sm">
          <p className="text-[10px] text-slate-600">支払を受ける者 住所又は居所</p>
          <p className="min-h-6">{slip.address}</p>
        </div>
        <div className="border border-slate-500 p-1.5 text-sm">
          <p className="text-[10px] text-slate-600">氏名{slip.kana && `(フリガナ ${slip.kana})`}</p>
          <p className="text-base font-medium">{slip.name}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4">
        <Box label="種別">
          <span className="block text-left">給料・賞与</span>
        </Box>
        <Box label="支払金額">{num(slip.pay)}</Box>
        <Box label="給与所得控除後の金額">{num(slip.income)}</Box>
        <Box label="所得控除の額の合計額">{num(slip.deductions)}</Box>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4">
        <Box label="源泉徴収税額">
          <span className="font-semibold">{num(slip.tax)}</span>
        </Box>
        <Box label="控除対象配偶者の有無等">
          <span className="block text-left">{spouseMark}</span>
        </Box>
        <Box label="配偶者(特別)控除の額">{slip.spouseAmount ? num(slip.spouseAmount) : ""}</Box>
        <Box label="控除対象扶養親族の数">
          <span className="block text-left text-xs">
            特定 {slip.dependents.specific}人 / 老人 {slip.dependents.elderly}人(内 同居老親等 {slip.dependents.elderlyLiving}人) / その他 {slip.dependents.general}人
          </span>
        </Box>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-5">
        <Box label="社会保険料等の金額">{num(slip.social)}</Box>
        <Box label="生命保険料の控除額">{slip.lifeInsurance ? num(slip.lifeInsurance) : ""}</Box>
        <Box label="地震保険料の控除額">{slip.earthquakeInsurance ? num(slip.earthquakeInsurance) : ""}</Box>
        <Box label="住宅借入金等特別控除の額">{slip.housingLoan ? num(slip.housingLoan) : ""}</Box>
        <Box label="基礎控除の額">{num(slip.basic)}</Box>
      </div>
      <div className="grid sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="border border-slate-500 p-1.5 text-sm">
          <p className="text-[10px] text-slate-600">(摘要)</p>
          <p className="min-h-6 text-xs">{notes.join(" / ")}</p>
        </div>
        <div className="grid grid-cols-2">
          <div className="border border-slate-500 p-1.5 text-xs">
            <p className="text-[10px] text-slate-600">受給者生年月日</p>
            <p>{wareki(slip.birthDate)}</p>
          </div>
          <div className="border border-slate-500 p-1.5 text-xs">
            <p className="text-[10px] text-slate-600">中途就・退職</p>
            <p>{slip.retireDate ? `退職 ${wareki(slip.retireDate)}` : ""}</p>
          </div>
        </div>
      </div>
      <div className="border border-slate-500 p-1.5 text-sm">
        <p className="text-[10px] text-slate-600">支払者 住所(居所)又は所在地 / 氏名又は名称 / 電話</p>
        <p>{company.address ?? ""}</p>
        <p className="font-medium">
          {company.name}
          {company.phone && <span className="ml-3 text-xs font-normal">電話 {company.phone}</span>}
        </p>
      </div>
      <p className="text-right text-[10px] text-slate-400 print:hidden">この様式は画面での確認・本人への交付用です。税務署・市区町村への提出は、所定の様式や電子申告で行ってください。</p>
    </article>
  );
}

export default async function SlipsPage({ searchParams }: { searchParams: Promise<{ year?: string; staff?: string }> }) {
  const companyId = await requireCompanyId();
  const sp = await searchParams;
  let year: number;
  try {
    year = parseYear(sp.year);
  } catch {
    year = parseYear(undefined);
  }
  const data = await getSlips(companyId, year, sp.staff);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div>
          <Link href={`/year-end?year=${year}`} className="text-sm text-indigo-700 hover:underline">
            ← 年末調整の一覧
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">源泉徴収票({year}年分)</h1>
          <p className="mt-1 text-sm text-slate-600">
            {data.slips.length}人分。年末調整を確定した人は年税額、確定していない人は徴収した税額を載せます。1人1枚で印刷されます。
          </p>
        </div>
        <PrintButton />
      </div>
      {data.slips.map((slip) => (
        <SlipView key={slip.staffId} slip={slip} year={year} company={data.company} />
      ))}
      {data.slips.length === 0 && <p className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">{year}年に支払った給料・賞与がありません。</p>}
    </div>
  );
}

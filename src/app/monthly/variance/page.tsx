import Link from "next/link";
import { requireCompanyId } from "@/lib/auth/session";
import { getBudgetVariance } from "@/lib/budgetVariance";
import { aiEnabled } from "@/lib/ai/access";
import VarianceView from "./VarianceView";

export const dynamic = "force-dynamic";

export default async function BudgetVariancePage({ searchParams }: { searchParams: Promise<{ fy?: string }> }) {
  const companyId = await requireCompanyId();
  const r = await getBudgetVariance(companyId, (await searchParams).fy);
  const ai = await aiEnabled(companyId);
  return (
    <div className="space-y-6">
      <div>
        <Link href={`/monthly/progress?fy=${r.year}`} className="text-sm text-indigo-700 hover:underline">
          ← 予算の進み具合
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">予算と実績の差の原因</h1>
        <p className="mt-1 text-sm text-slate-600">
          予算を超えた・超えそうな費用と、届かなそうな売上について、どの月が月の予算(年間予算の1/12)から外れたか、前年の同じ時期と比べてどの取引が増えた・減ったか、一度に大きな支払いがないかを出します。{ai ? "「AIに原因を聞く」で、AIが原因の見立てと次にやることを書きます。" : ""}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link href={`/monthly/variance?fy=${r.year - 1}`} className="rounded-md border px-2 py-1 hover:bg-slate-50" aria-label="前の年度">
          ◀
        </Link>
        <span className="font-medium">
          {r.year}年度({r.months[0].replace("-", "/")}〜{r.months[11].replace("-", "/")}・{r.elapsed === 12 ? "終わった年度" : r.elapsed === 0 ? "これからの年度" : `${r.elapsed}か月目`})
        </span>
        <Link href={`/monthly/variance?fy=${r.year + 1}`} className="rounded-md border px-2 py-1 hover:bg-slate-50" aria-label="次の年度">
          ▶
        </Link>
        {r.year !== r.current && (
          <Link href="/monthly/variance" className="text-indigo-700 hover:underline">
            今期
          </Link>
        )}
      </div>
      <VarianceView key={r.year} initial={r} ai={ai} />
    </div>
  );
}

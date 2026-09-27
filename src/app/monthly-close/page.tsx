import Link from "next/link";
import { requireCompanyId } from "@/lib/auth/session";
import { getMonthlyClose, getRecentProgress } from "@/lib/monthlyClose";
import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import { MonthlyCloseList } from "./MonthlyCloseList";

export const dynamic = "force-dynamic";

const label = (month: string) => `${Number(month.slice(0, 4))}年${Number(month.slice(5))}月`;

export default async function MonthlyClosePage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const companyId = await requireCompanyId();
  const { month } = await searchParams;
  let data;
  try {
    data = await getMonthlyClose(companyId, month);
  } catch (error) {
    if (!(error instanceof UserError)) throw error;
    data = await getMonthlyClose(companyId, undefined);
  }
  const [recent, company] = await Promise.all([getRecentProgress(companyId), prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { closeChecklist: true } })]);
  const customItems = Array.isArray(company.closeChecklist) ? company.closeChecklist.filter((v): v is string => typeof v === "string") : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">月次決算チェックリスト</h1>
        <p className="mt-1 text-sm text-slate-600">
          月末の締めでやることの一覧です。明細の確定・定期取引・減価償却・給料などはデータから自動で判定し、残高の突き合わせなど人が確かめる項目はチェックを付けます。
        </p>
      </div>

      <nav className="flex flex-wrap gap-2" aria-label="ここ数か月の進み具合">
        {recent.map((r) => {
          const complete = r.done === r.total;
          const current = r.month === data.month;
          return (
            <Link
              key={r.month}
              href={`/monthly-close?month=${r.month}`}
              className={`rounded-lg border px-3 py-2 text-xs shadow-sm ${current ? "border-indigo-600 ring-1 ring-indigo-600" : "border-slate-200"} ${complete ? "bg-emerald-50" : "bg-white"}`}
            >
              <span className="block font-medium text-slate-800">{label(r.month)}</span>
              <span className={`tabular-nums ${complete ? "text-emerald-700" : "text-slate-500"}`}>
                {complete ? "完了" : `${r.done} / ${r.total}`}
              </span>
            </Link>
          );
        })}
      </nav>

      <MonthlyCloseList initial={data} monthLabel={label(data.month)} customItems={customItems} />
    </div>
  );
}

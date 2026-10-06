import { requireCompanyId } from "@/lib/auth/session";
import { getYearEndChecklist, getYearEndReview } from "@/lib/yearEndClose";
import { YearEndView } from "./YearEndView";

export const dynamic = "force-dynamic";

// 決算の準備アシスト
export default async function YearEndClosePage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const companyId = await requireCompanyId();
  const c = await getYearEndChecklist(companyId, (await searchParams).year);
  const review = await getYearEndReview(companyId, c.fiscalYear);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">決算の準備</h1>
        <p className="mt-1 text-sm text-slate-600">期末が近づいたら(過ぎたら)、決算までにやることを帳簿から確かめて並べます。自動で確かめられる項目と、人が確かめてチェックする項目があります。AIが、残っている作業を何から手を付けるか順番にまとめます。</p>
      </div>
      <YearEndView initial={{ ...c, review: review ? { data: review.data, mode: review.mode, createdAt: review.createdAt.toISOString(), createdBy: review.createdBy } : null }} />
    </div>
  );
}

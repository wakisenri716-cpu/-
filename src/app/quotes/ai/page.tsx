import { requireCompanyId } from "@/lib/auth/session";
import { QuoteAssistView } from "./QuoteAssistView";

export const dynamic = "force-dynamic";

// AI見積アシスト
export default async function QuoteAssistPage({ searchParams }: { searchParams: Promise<{ customer?: string }> }) {
  await requireCompanyId();
  const { customer } = await searchParams;
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">AI見積アシスト</h1>
        <p className="mt-1 text-sm text-slate-600">
          見積の内容を話すように書くと、AIが明細(品目・数量・単位・単価)に分けます。単価は、これまでに出した請求書・見積書の同じような品目(その顧客のものを優先)を参考にし、過去の単価と大きく違う明細には目印を付けます。確かめてから見積書の作成画面で仕上げます。
        </p>
      </div>
      <QuoteAssistView initialCustomer={customer?.slice(0, 100) ?? ""} />
    </div>
  );
}

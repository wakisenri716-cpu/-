import { requireCompanyId } from "@/lib/auth/session";
import { aiEnabled } from "@/lib/ai/access";
import { getEntertainment } from "@/lib/entertainment";
import EntertainmentView from "./EntertainmentView";

export const dynamic = "force-dynamic";

export default async function EntertainmentPage() {
  const companyId = await requireCompanyId();
  const [data, ai] = await Promise.all([getEntertainment(companyId), aiEnabled(companyId)]);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">交際費の管理</h1>
        <p className="mt-1 text-sm text-slate-600">
          今期の接待交際費を、損金にできる上限(資本金1億円以下の会社は年800万円)と比べます。1人あたり1万円以下の飲食費は、相手・人数などを記録しておけば交際費から除けるので、明細ごとに記録を入れられます。上限・基準は一般的な目安です。判断に迷うときは税理士に確かめてください。
        </p>
      </div>
      <EntertainmentView initial={data} ai={ai} />
    </div>
  );
}

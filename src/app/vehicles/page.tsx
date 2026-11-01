import Link from "next/link";
import { requireCompanyId } from "@/lib/auth/session";
import { listVehicles } from "@/lib/vehicles";
import VehicleView from "./VehicleView";

export const dynamic = "force-dynamic";

export default async function VehiclesPage() {
  const companyId = await requireCompanyId();
  const vehicles = await listVehicles(companyId);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">社用車の管理</h1>
        <p className="mt-1 text-sm text-slate-600">
          社用車ごとに、ナンバー・車検と任意保険の満了日・次の点検(オイル交換など)のメーターを入れておくと、満了日の30日前から、点検のメーターの500km手前から、ここと<Link href="/" className="text-indigo-700 underline">やることリスト</Link>で知らせます。いまのメーターと今月の距離は<Link href="/alcohol-checks" className="text-indigo-700 underline">運転日誌</Link>から出します。社用車は<Link href="/bookings" className="text-indigo-700 underline">会議室・社用車の予約</Link>で登録します。
        </p>
      </div>
      <VehicleView initial={vehicles} />
    </div>
  );
}

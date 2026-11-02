import { requireCompanyId } from "@/lib/auth/session";
import { listSupplyRequests } from "@/lib/supplyRequests";
import SuppliesView from "./SuppliesView";

export const dynamic = "force-dynamic";

export default async function SuppliesPage() {
  const companyId = await requireCompanyId();
  const data = await listSupplyRequests(companyId);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">備品・消耗品の購入依頼</h1>
        <p className="mt-1 text-sm text-slate-600">
          従業員がClerkly従業員用の「購入依頼」から頼んだものが、同じ品物ごとにまとまって届きます(至急のものはメールでも知らせます)。品物を選び、発注先と単価(前に買った単価が入っています)を確かめて「発注書を作る」を押すと、発注書ができます。届いたら「届いた」を押すと、頼んだ人に知らせます。
        </p>
      </div>
      <SuppliesView initial={JSON.parse(JSON.stringify(data))} />
    </div>
  );
}

import { requireCompanyId } from "@/lib/auth/session";
import { listShipments } from "@/lib/shipments";
import { jstDateKey } from "@/lib/jst";
import ShipmentsView from "./ShipmentsView";

export const dynamic = "force-dynamic";

export default async function ShipmentsPage() {
  const companyId = await requireCompanyId();
  const data = await listShipments(companyId, jstDateKey(new Date()).slice(0, 7));
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">郵便・宅配の発送記録</h1>
        <p className="mt-1 text-sm text-slate-600">
          「さくら商事へ請求書 レターパックライト 追跡 1234-5678-9012」「みどり商店にサンプル 宅急便 1,060円」のように1行で書くと、相手・中身・送り方・送料・追跡番号に分けて記録します(レターパック・スマートレターは決まった送料を入れます)。追跡番号があれば、日本郵便・ヤマト運輸・佐川急便の追跡のページを開けます。現金で払った送料は、月ごとにまとめて通信費で仕訳できます(前に買ってある切手・レターパックや、月払いの請求は仕訳しません)。
        </p>
      </div>
      <ShipmentsView initial={JSON.parse(JSON.stringify(data))} />
    </div>
  );
}

import { requireCompanyId } from "@/lib/auth/session";
import { getDuplicateParties } from "@/lib/partyMerge";
import { PartyDuplicatesView } from "./PartyDuplicatesView";

export const dynamic = "force-dynamic";

// 取引先の重複(同じ相手が2つ以上登録されているものをまとめる)
export default async function PartyDuplicatesPage() {
  const companyId = await requireCompanyId();
  const r = await getDuplicateParties(companyId);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">取引先の重複</h1>
        <p className="mt-1 text-sm text-slate-600">
          「株式会社A」と「(株)A」のように、同じ相手が2つ以上登録されている仕入先・支払先と顧客を見つけて1つにまとめます。まとめると、請求書・経費・発注書・見積書などの付け先が残す方に移り、残す方にない情報(メール・住所・振込先の口座・登録番号など)を写してから、まとめた方を消します。似ている名前は別の相手のこともあるので、AIの見立てと登録番号・住所で確かめてからまとめてください。
        </p>
      </div>
      <PartyDuplicatesView initial={r} />
    </div>
  );
}

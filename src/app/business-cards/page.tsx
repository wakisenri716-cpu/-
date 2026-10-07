import { requireCompanyId } from "@/lib/auth/session";
import { aiEnabled } from "@/lib/ai/access";
import BusinessCardView from "./BusinessCardView";

export const dynamic = "force-dynamic";

export default async function BusinessCardsPage() {
  const companyId = await requireCompanyId();
  const ai = await aiEnabled(companyId);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">名刺の取り込み</h1>
        <p className="mt-1 text-sm text-slate-600">
          {ai ? "名刺の写真を撮る(選ぶ)と、AIが会社名・部署・氏名・メール・電話・住所を読み取ります。机に何枚か並べて1枚の写真にしても読み取れます。" : "名刺の文字を貼り付ける(入力する)と、会社名・氏名・メール・電話・住所などに分けます。"}
          内容を確かめて、顧客か仕入先として住所録に登録します。もう登録されている相手なら、空いている項目(担当者・電話・住所など)だけを埋めます。登録した相手は請求書・送付状・封筒・宛名ラベルの宛先に使えます。
        </p>
      </div>
      <BusinessCardView ai={ai} />
    </div>
  );
}

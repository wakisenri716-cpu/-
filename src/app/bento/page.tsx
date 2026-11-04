import { requireCompanyId } from "@/lib/auth/session";
import BentoAdmin from "./BentoAdmin";

export const dynamic = "force-dynamic";

export default async function BentoPage() {
  await requireCompanyId();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">お弁当の注文</h1>
        <p className="mt-1 text-sm text-slate-600">
          お店のメニューを「のり弁 450円、唐揚げ弁当 550円」のように貼りつけて登録します(AIが使えるときは「AIで読む」で、チラシの文のような長い文も読みます。文にない値段は使いません)。社員は従業員用の「お弁当」から締め切りまでに頼み、締め切りのあとに今日の注文をまとめてお店にメールで送れます。月ごとに一人いくらかを出し、集金したかをつけます。
        </p>
      </div>
      <BentoAdmin />
    </div>
  );
}

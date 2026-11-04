import { requireCompanyId } from "@/lib/auth/session";
import { LostView } from "@/app/staff/lost/LostView";

export const dynamic = "force-dynamic";

export default async function LostItemsPage() {
  await requireCompanyId();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">落とし物・忘れ物</h1>
        <p className="mt-1 text-sm text-slate-600">
          見つけた人が「会議室Aに黒い折りたたみ傘 総務であずかり中」のように1行で届け、なくした人は「黒い傘」で探せます(AIが使えるときは、かさ・アンブレラのような言いかえも見て並べます)。持ち主が「わたしのです」と名のると総務にメールで知らせるので、本人か確かめて渡し「返した」にします。30日すぎても持ち主が見つからないものは、やることリストで処分を判断するよう知らせます。
        </p>
      </div>
      <LostView admin />
    </div>
  );
}

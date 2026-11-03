import { requireCompanyId } from "@/lib/auth/session";
import { upcomingCelebrations } from "@/lib/celebrations";
import CelebrationsView from "./CelebrationsView";

export const dynamic = "force-dynamic";

export default async function CelebrationsPage() {
  const companyId = await requireCompanyId();
  const upcoming = await upcomingCelebrations(companyId);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">誕生日・入社の記念日</h1>
        <p className="mt-1 text-sm text-slate-600">
          労働者名簿の生年月日と入社日から、これから30日のお祝いを並べます。「言葉を作る」でお祝いの言葉の案を作り(AIが使えるときは「AIで考える」。その人の仕事ぶりなどをひとこと入れると、それも入れます)、本人にメールとアプリの通知で送ります。社内のお知らせにも出せます。年齢は出しません。
        </p>
      </div>
      <CelebrationsView initial={JSON.parse(JSON.stringify(upcoming))} />
    </div>
  );
}

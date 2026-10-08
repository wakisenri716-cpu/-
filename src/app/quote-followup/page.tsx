import { requireCompanyId } from "@/lib/auth/session";
import { aiEnabled } from "@/lib/ai/access";
import { getFollowups } from "@/lib/quoteFollowup";
import QuoteFollowupView from "./QuoteFollowupView";

export const dynamic = "force-dynamic";

export default async function QuoteFollowupPage() {
  const companyId = await requireCompanyId();
  const [data, ai] = await Promise.all([getFollowups(companyId), aiEnabled(companyId)]);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">見積のフォロー</h1>
        <p className="mt-1 text-sm text-slate-600">
          出したまま返事を待っている見積書を、送ってからの日数と有効期限で「追いかけどき」(送って7日、前に追いかけて7日)・「期限まぢか」(7日以内)・「まだ送っていない」・「期限切れ」に分けます。追いかけのメールの下書きを作って送るか、有効期限を延ばすか、断られたら取り消してください。
        </p>
      </div>
      <QuoteFollowupView initial={data} ai={ai} />
    </div>
  );
}

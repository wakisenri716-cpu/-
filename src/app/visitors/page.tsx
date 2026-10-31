import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { memoContext } from "@/lib/phoneMemos";
import { listVisitors } from "@/lib/visitors";
import { jstDateKey } from "@/lib/jst";
import VisitorView from "./VisitorView";

export const dynamic = "force-dynamic";

export default async function VisitorsPage() {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const [visitors, ctx] = await Promise.all([listVisitors(companyId), memoContext(companyId)]);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">来客の受付簿</h1>
        <p className="mt-1 text-sm text-slate-600">
          「明日14時 さくら商事 佐藤様 山田さん宛 打ち合わせ」のように1行で書いて「読み取る」を押すと、日時・会社・お名前・担当・用件に分けて予定に入れます。お見えになったら「お見えになった」を押すと、担当の人にメールで知らせます。同じ日に相手の名前が入った会議室の予約があれば並べて出します。
        </p>
      </div>
      <VisitorView initial={JSON.parse(JSON.stringify(visitors))} users={ctx.users.map((u) => ({ id: u.id, name: u.name, email: !!u.email }))} viewerId={user.id} today={jstDateKey(new Date())} />
    </div>
  );
}

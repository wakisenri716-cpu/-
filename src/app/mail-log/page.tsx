import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { aiEnabled } from "@/lib/ai/access";
import { memoContext } from "@/lib/phoneMemos";
import { listMailItems } from "@/lib/mailItems";
import { jstDateKey } from "@/lib/jst";
import MailLogView from "./MailLogView";

export const dynamic = "force-dynamic";

export default async function MailLogPage() {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const [items, ctx, ai] = await Promise.all([listMailItems(companyId, user.id), memoContext(companyId), aiEnabled(companyId)]);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">郵便物・荷物の受付</h1>
        <p className="mt-1 text-sm text-slate-600">
          届いた郵便物・荷物を「さくら商事から請求書 田中さん宛」のように1行に1つ書いて「分ける」{ai ? "(まとめて書いたメモは「AIで分ける」)" : ""}を押すと、差出人・種類・宛先に分けます。記録したものは宛先の人のやることリストに出て、メールでも知らせられます。書留・役所から・請求書は目立たせます。渡したら「渡した」にしてください。
        </p>
      </div>
      <MailLogView
        initial={JSON.parse(JSON.stringify(items))}
        users={ctx.users.map((u) => ({ id: u.id, name: u.name, email: !!u.email }))}
        viewerId={user.id}
        today={jstDateKey(new Date())}
        ai={ai}
      />
    </div>
  );
}

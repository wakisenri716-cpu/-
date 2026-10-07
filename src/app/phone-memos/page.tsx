import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { aiEnabled } from "@/lib/ai/access";
import { listMemos, memoContext } from "@/lib/phoneMemos";
import PhoneMemoView from "./PhoneMemoView";

export const dynamic = "force-dynamic";

export default async function PhoneMemosPage() {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const [memos, ctx, ai] = await Promise.all([listMemos(companyId, user.id), memoContext(companyId), aiEnabled(companyId)]);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">伝言メモ</h1>
        <p className="mt-1 text-sm text-slate-600">
          電話・来客の伝言を残します。走り書きを入れて「項目に分ける」{ai ? "(または「AIで整理」)" : ""}を押すと、相手の会社・名前・電話番号・宛先・折り返しの要否・急ぎかを分けます。残した伝言は宛先の人のやることリストに出て、メールでも知らせられます。折り返したら「対応済み」にしてください。
        </p>
      </div>
      <PhoneMemoView
        initial={JSON.parse(JSON.stringify(memos))}
        users={ctx.users.map((u) => ({ id: u.id, name: u.name, email: !!u.email }))}
        parties={ctx.parties.map((p) => ({ kind: p.kind, id: p.id, name: p.name }))}
        viewerId={user.id}
        ai={ai}
      />
    </div>
  );
}

import { requireCompanyId } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { aiEnabled } from "@/lib/ai/access";
import MailReplyView from "./MailReplyView";

export const dynamic = "force-dynamic";

export default async function MailReplyPage() {
  const companyId = await requireCompanyId();
  const [customers, ai] = await Promise.all([prisma.customer.findMany({ where: { companyId }, select: { id: true, name: true }, orderBy: { name: "asc" } }), aiEnabled(companyId)]);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">メールの返信</h1>
        <p className="mt-1 text-sm text-slate-600">
          取引先から届いたメールを貼り付けると、相手(顧客)と用件(見積・請求書・入金・支払の相談・日程・お詫び・注文・お礼)を見分け、その顧客の未入金の請求書・最近の入金・出している見積をそろえて返信の下書きを作ります。
          {ai ? "「AIで書く」を使うと、メールの中身と方針のメモに合わせて自然な返信に書き直します(帳簿にない金額・日付は書きません)。" : ""}
          メールはここからは送りません。コピーするか、メールソフトで開いて送ってください。
        </p>
      </div>
      <MailReplyView customers={customers} ai={ai} />
    </div>
  );
}

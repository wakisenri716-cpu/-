import { requireMember } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { aiEnabled } from "@/lib/ai/access";
import { jstDateKey } from "@/lib/jst";
import { POLICY_KINDS } from "@/lib/policyDrafts";
import PolicyDraftView from "./PolicyDraftView";

export const dynamic = "force-dynamic";

export default async function PoliciesPage() {
  const user = await requireMember();
  const [company, ai] = await Promise.all([prisma.company.findUniqueOrThrow({ where: { id: user.companyId }, select: { name: true } }), aiEnabled(user.companyId)]);
  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <h1 className="text-2xl font-semibold">社内規程の下書き</h1>
        <p className="mt-1 text-sm text-slate-600">
          経費精算規程・在宅勤務規程・慶弔見舞金規程を、会社の条件を入れて「第1条〜」の形で作ります。AIを使うと、会社の事情(メモ)に合わせて条文を直します。下書きは保存しないので、画面で直して印刷・PDF保存してください。導入の前に社労士・税理士に確かめてもらいましょう。
        </p>
      </div>
      <PolicyDraftView kinds={POLICY_KINDS} company={company.name} today={jstDateKey(new Date())} ai={ai} />
    </div>
  );
}

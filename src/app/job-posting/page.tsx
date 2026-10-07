import { requireCompanyId } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { aiEnabled } from "@/lib/ai/access";
import JobPostingView from "./JobPostingView";

export const dynamic = "force-dynamic";

export default async function JobPostingPage() {
  const companyId = await requireCompanyId();
  const [company, ai] = await Promise.all([prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { address: true } }), aiEnabled(companyId)]);
  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <h1 className="text-2xl font-semibold">求人票の下書き</h1>
        <p className="mt-1 text-sm text-slate-600">
          職種・仕事内容・賃金などを入れると、求人票に書くべき項目(業務と就業場所の「変更の範囲」・試用期間・加入保険など)をそろえた下書きを作り、年齢・性別などで応募を限るように読める言い方がないかを確かめます。AIが使えるときは、仕事内容とアピールを読みやすく書き直します。下書きは保存しないので、印刷・PDF保存するか、ハローワークや求人サイトに写して使ってください。
        </p>
      </div>
      <JobPostingView defaultWorkplace={company.address ?? ""} ai={ai} />
    </div>
  );
}

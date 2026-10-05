import { requireCompanyId } from "@/lib/auth/session";
import { getAccountReview } from "@/lib/accountReview";
import { EXPENSE_ACCOUNT_CODES } from "@/lib/accounting/chartOfAccounts";
import { prisma } from "@/lib/prisma";
import { AccountReviewView } from "./AccountReviewView";

export const dynamic = "force-dynamic";

// 科目の見直し(記帳した経費の勘定科目が合っているかを見直して、振替で直す)
export default async function AccountReviewPage() {
  const companyId = await requireCompanyId();
  const [r, accounts] = await Promise.all([
    getAccountReview(companyId),
    prisma.account.findMany({ where: { companyId, code: { in: EXPENSE_ACCOUNT_CODES }, hidden: false }, select: { code: true, name: true }, orderBy: { code: "asc" } }),
  ]);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">科目の見直し</h1>
        <p className="mt-1 text-sm text-slate-600">
          直近180日に記帳した経費の仕訳の勘定科目が合っているかを見直します。摘要の言葉・取引先のいつもの科目から決まったルールで探し、AIが摘要や金額を読んでほかにも科目が違いそうなものを探します。直すときは元の仕訳はそのままにして、正しい科目へ振り替える仕訳を作ります(締めた期間の仕訳は今日の日付で振り替えます)。
        </p>
      </div>
      <AccountReviewView initial={r} accounts={accounts} />
    </div>
  );
}

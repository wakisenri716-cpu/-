import { requireMember } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { EXPENSE_ACCOUNT_CODES } from "@/lib/accounting/chartOfAccounts";
import { QuickExpenseView } from "./QuickExpenseView";

export const dynamic = "force-dynamic";

// ひとことで経費入力(従業員も使える)
export default async function QuickExpensePage() {
  const user = await requireMember();
  const accounts = await prisma.account.findMany({ where: { companyId: user.companyId, code: { in: EXPENSE_ACCOUNT_CODES } }, select: { code: true, name: true }, orderBy: { code: "asc" } });
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">ひとことで経費入力</h1>
        <p className="mt-1 text-sm text-slate-600">立て替えた経費を、話すように書くだけでAIが日付・内容・金額・勘定科目に分けます。確かめてから、あなたの経費精算に入れます。領収書があるものは、あとで経費精算の画面から写真を付けてください。</p>
      </div>
      <QuickExpenseView accounts={accounts} />
    </div>
  );
}

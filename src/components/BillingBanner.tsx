import Link from "next/link";
import { isFreeCompany, type BillingState } from "@/lib/billing";

// 管理者向け: 無料期間の残りが少ないとき・支払いに失敗したときのお知らせ
export async function BillingBanner({ billing, companyId }: { billing: BillingState; companyId: string }) {
  const soon = billing.phase === "trial" && billing.daysLeft <= 7;
  if (!soon && billing.phase !== "past_due") return null;
  if (await isFreeCompany(companyId)) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 print:hidden">
      <span>
        {billing.phase === "past_due"
          ? "お支払いができませんでした。カードの情報を確かめてください(しばらくするとご利用が止まります)。"
          : `無料期間はあと${billing.daysLeft}日です。続けて使うには、有料プランにお申し込みください。`}
      </span>
      <Link href="/billing" className="rounded-md bg-amber-600 px-3 py-1.5 font-medium whitespace-nowrap text-white hover:bg-amber-700">
        契約・お支払い
      </Link>
    </div>
  );
}

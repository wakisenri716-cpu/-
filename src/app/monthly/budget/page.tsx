import { requireCompanyId } from "@/lib/auth/session";
import { getBudgets } from "@/lib/accounting/monthly";
import { BudgetForm } from "./BudgetForm";

export const dynamic = "force-dynamic";

export default async function BudgetPage({ searchParams }: { searchParams: Promise<{ fy?: string }> }) {
  const companyId = await requireCompanyId();
  const { fy } = await searchParams;
  const data = await getBudgets(companyId, fy);
  return <BudgetForm year={data.year} accounts={data.accounts} />;
}

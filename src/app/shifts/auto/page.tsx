import { requireCompanyId } from "@/lib/auth/session";
import { aiEnabled } from "@/lib/ai/access";
import AutoShift from "./AutoShift";

export const dynamic = "force-dynamic";

export default async function AutoShiftPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const companyId = await requireCompanyId();
  const { month } = await searchParams;
  return <AutoShift initialMonth={month && /^\d{4}-\d{2}$/.test(month) ? month : null} ai={await aiEnabled(companyId)} />;
}

import { requireCompanyId } from "@/lib/auth/session";
import { MonthlyChangeView } from "./MonthlyChangeView";

export const dynamic = "force-dynamic";

export default async function MonthlyChangePage() {
  await requireCompanyId();
  return <MonthlyChangeView />;
}

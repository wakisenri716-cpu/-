import { requireCompanyId } from "@/lib/auth/session";
import { CashCountView } from "./CashCountView";

export const dynamic = "force-dynamic";

export default async function CashCountPage() {
  await requireCompanyId();
  return <CashCountView />;
}

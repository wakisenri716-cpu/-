import { requireCompanyId } from "@/lib/auth/session";
import { OpeningBalancesView } from "./OpeningBalancesView";

export const dynamic = "force-dynamic";

export default async function OpeningBalancesPage() {
  await requireCompanyId();
  return <OpeningBalancesView />;
}

import { requireCompanyId } from "@/lib/auth/session";
import { AnomaliesView } from "./AnomaliesView";

export const dynamic = "force-dynamic";

export default async function AnomaliesPage() {
  await requireCompanyId();
  return <AnomaliesView />;
}

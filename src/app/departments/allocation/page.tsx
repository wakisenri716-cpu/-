import { requireCompanyId } from "@/lib/auth/session";
import { AllocationView } from "./AllocationView";

export const dynamic = "force-dynamic";

export default async function CostAllocationPage() {
  await requireCompanyId();
  return <AllocationView />;
}

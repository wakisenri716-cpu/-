import { requireCompanyId } from "@/lib/auth/session";
import { DuplicatesView } from "./DuplicatesView";

export const dynamic = "force-dynamic";

export default async function DuplicatesPage() {
  await requireCompanyId();
  return <DuplicatesView />;
}

import { requireCompanyId } from "@/lib/auth/session";
import { ForeignView } from "./ForeignView";

export const dynamic = "force-dynamic";

export default async function ForeignPage() {
  await requireCompanyId();
  return <ForeignView />;
}

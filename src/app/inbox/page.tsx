import { requireCompanyId } from "@/lib/auth/session";
import { InboxView } from "./InboxView";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  await requireCompanyId();
  return <InboxView />;
}

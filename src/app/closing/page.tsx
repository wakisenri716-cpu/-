import { requireUser } from "@/lib/auth/session";
import { getClosing } from "@/lib/accounting/closing";
import { ClosingForm } from "./ClosingForm";

export const dynamic = "force-dynamic";

export default async function ClosingPage() {
  const user = await requireUser();
  const closing = await getClosing(user.companyId);
  return <ClosingForm initial={closing} canEdit={user.role === "ADMIN"} />;
}

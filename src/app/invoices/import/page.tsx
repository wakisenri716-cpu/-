import { requireCompanyId } from "@/lib/auth/session";
import { InvoiceImportView } from "./InvoiceImportView";

export const dynamic = "force-dynamic";

export default async function InvoiceImportPage() {
  await requireCompanyId();
  return <InvoiceImportView />;
}

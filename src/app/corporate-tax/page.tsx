import { requireCompanyId } from "@/lib/auth/session";
import { CorporateTaxView } from "./CorporateTaxView";

export const dynamic = "force-dynamic";

export default async function CorporateTaxPage({ searchParams }: { searchParams: Promise<{ fy?: string }> }) {
  await requireCompanyId();
  const fy = Number((await searchParams).fy);
  return <CorporateTaxView initialYear={Number.isInteger(fy) && fy > 1900 && fy < 3000 ? fy : null} />;
}

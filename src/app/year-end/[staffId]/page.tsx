import { requireCompanyId } from "@/lib/auth/session";
import { parseYear } from "@/lib/payroll/yearEnd";
import { StaffYearEnd } from "./StaffYearEnd";

export const dynamic = "force-dynamic";

export default async function StaffYearEndPage({ params, searchParams }: { params: Promise<{ staffId: string }>; searchParams: Promise<{ year?: string }> }) {
  await requireCompanyId();
  const [{ staffId }, { year }] = await Promise.all([params, searchParams]);
  let y: number;
  try {
    y = parseYear(year);
  } catch {
    y = parseYear(undefined);
  }
  return <StaffYearEnd staffId={staffId} year={y} />;
}

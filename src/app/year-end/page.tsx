import { requireCompanyId } from "@/lib/auth/session";
import { parseYear } from "@/lib/payroll/yearEnd";
import { YearEndList } from "./YearEndList";

export const dynamic = "force-dynamic";

export default async function YearEndPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  await requireCompanyId();
  const { year } = await searchParams;
  let y: number;
  try {
    y = parseYear(year);
  } catch {
    y = parseYear(undefined);
  }
  return <YearEndList year={y} />;
}

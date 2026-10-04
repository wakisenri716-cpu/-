import { ShiftsView } from "./ShiftsView";

export default async function StaffShiftsPage({ searchParams }: { searchParams: Promise<{ tab?: string; month?: string }> }) {
  const sp = await searchParams;
  return <ShiftsView initialTab={sp.tab === "confirmed" ? "confirmed" : "request"} initialMonth={sp.month ?? null} />;
}

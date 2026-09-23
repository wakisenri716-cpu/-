import { getDefaultCompanyId } from "@/lib/demo";
import { createShift, getWeek } from "@/lib/shifts/service";
import { respond } from "@/lib/shifts/http";
import { shiftInput } from "./input";

export async function GET(request: Request) {
  const companyId = await getDefaultCompanyId();
  const week = new URL(request.url).searchParams.get("week") ?? new Date().toISOString().slice(0, 10);
  return respond(() => getWeek(companyId, week));
}

export async function POST(request: Request) {
  const companyId = await getDefaultCompanyId();
  const body = await request.json().catch(() => ({}));
  return respond(() => createShift(companyId, shiftInput(body)), 201);
}

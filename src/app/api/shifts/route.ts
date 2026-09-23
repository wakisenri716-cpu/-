import { requireCompanyId } from "@/lib/auth/session";
import { createShift, getWeek } from "@/lib/shifts/service";
import { respond } from "@/lib/shifts/http";
import { shiftInput } from "./input";

export async function GET(request: Request) {
  const companyId = await requireCompanyId();
  const week = new URL(request.url).searchParams.get("week") ?? new Date().toISOString().slice(0, 10);
  return respond(() => getWeek(companyId, week));
}

export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  return respond(() => createShift(companyId, shiftInput(body)), 201);
}

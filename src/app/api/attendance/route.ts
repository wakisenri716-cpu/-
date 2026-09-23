import { getDefaultCompanyId } from "@/lib/demo";
import { getAttendanceWeek, saveRecord } from "@/lib/attendance/service";
import { respond } from "@/lib/shifts/http";
import { recordInput } from "./input";

export async function GET(request: Request) {
  const companyId = await getDefaultCompanyId();
  const week = new URL(request.url).searchParams.get("week") ?? new Date().toISOString().slice(0, 10);
  return respond(() => getAttendanceWeek(companyId, week));
}

export async function POST(request: Request) {
  const companyId = await getDefaultCompanyId();
  const body = await request.json().catch(() => ({}));
  return respond(() => saveRecord(companyId, null, recordInput(body)), 201);
}

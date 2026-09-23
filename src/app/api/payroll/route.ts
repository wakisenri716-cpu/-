import { requireCompanyId } from "@/lib/auth/session";
import { getMonthlyPayroll, postPayroll, voidPayroll } from "@/lib/shifts/service";
import { respond } from "@/lib/shifts/http";

function monthParam(request: Request) {
  return new URL(request.url).searchParams.get("month") ?? "";
}

export async function GET(request: Request) {
  const companyId = await requireCompanyId();
  return respond(() => getMonthlyPayroll(companyId, monthParam(request)));
}

export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  return respond(() => postPayroll(companyId, String(body.month ?? "")), 201);
}

export async function DELETE(request: Request) {
  const companyId = await requireCompanyId();
  return respond(() => voidPayroll(companyId, monthParam(request)));
}

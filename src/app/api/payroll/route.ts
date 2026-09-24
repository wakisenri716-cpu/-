import { requireCompanyId } from "@/lib/auth/session";
import { getMonthlyPayroll, postPayroll, voidPayroll } from "@/lib/shifts/service";
import { respond } from "@/lib/shifts/http";
import { audit } from "@/lib/audit";

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
  return respond(async () => {
    const result = await postPayroll(companyId, String(body.month ?? ""));
    await audit("給料を計上", String(body.month ?? ""));
    return result;
  }, 201);
}

export async function DELETE(request: Request) {
  const companyId = await requireCompanyId();
  return respond(async () => {
    const result = await voidPayroll(companyId, monthParam(request));
    await audit("給料の計上を取消", monthParam(request));
    return result;
  });
}

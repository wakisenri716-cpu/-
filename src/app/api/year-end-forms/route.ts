import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { askForYearEndForms, listYearEndForms } from "@/lib/yearEndForms";
import { audit } from "@/lib/audit";

export async function GET(request: Request) {
  const companyId = await requireCompanyId();
  return respond(() => listYearEndForms(companyId, new URL(request.url).searchParams.get("year") ?? undefined));
}

// { action: "ask", year, deadline, notify } まだ出していない人にお願いする
export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const body = (await request.json().catch(() => ({}))) ?? {};
  return respond(async () => {
    const r = await askForYearEndForms({ id: user.id, name: user.name, companyId, role: user.role }, body, request);
    await audit("年末調整の申告をお願い", `${body.year ?? ""}年 ${r.asked}人`);
    return r;
  });
}

import { NextResponse } from "next/server";
import { getCurrentSessionId, requireUser } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { switchCompany } from "@/lib/auth/companies";
import { audit } from "@/lib/audit";

// 開く会社を切り替える(この端末のログインだけ)
export async function POST(request: Request) {
  const user = await requireUser();
  const sessionId = await getCurrentSessionId();
  if (!sessionId) return NextResponse.json({ error: "ログインし直してください" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    const company = await switchCompany(sessionId, user.id, String(body.companyId ?? ""));
    await audit("会社を切り替え", company.name, { ...user, companyId: company.id });
    return company;
  });
}

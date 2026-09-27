import { NextResponse } from "next/server";
import { getCurrentSessionId, requireUser } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { createCompany, listMyCompanies, switchCompany } from "@/lib/auth/companies";
import { audit } from "@/lib/audit";

export async function GET() {
  const user = await requireUser();
  return respond(async () => ({ current: user.companyId, companies: await listMyCompanies(user.id) }));
}

// 会社を追加して、そのまま開く(管理者だけ)
export async function POST(request: Request) {
  const user = await requireUser();
  if (user.role !== "ADMIN") return NextResponse.json({ error: "会社を追加できるのは管理者だけです" }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    const company = await createCompany(user.id, body);
    await audit("会社を追加", company.name);
    const sessionId = await getCurrentSessionId();
    if (sessionId) await switchCompany(sessionId, user.id, company.id);
    await audit("会社を追加", `${company.name}(追加した会社)`, { ...user, companyId: company.id });
    return { id: company.id, name: company.name };
  }, 201);
}

import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { checkAnomaly, findAnomalies } from "@/lib/anomalies";
import { audit } from "@/lib/audit";

export async function GET(request: Request) {
  const companyId = await requireCompanyId();
  return respond(() => findAnomalies(companyId, new URL(request.url).searchParams.get("month")));
}

// { key, note } 確認した(問題なし)
export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    const r = await checkAnomaly(companyId, user, body.key, body.note);
    await audit("異常検知の項目を確認済みに", String(body.title ?? r.key).slice(0, 100));
    return r;
  });
}

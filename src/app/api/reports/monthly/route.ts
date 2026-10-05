import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { generateMonthlyReport, getMonthlyReports } from "@/lib/assistant/monthlyReport";
import { audit } from "@/lib/audit";

export async function GET() {
  const companyId = await requireCompanyId();
  return respond(async () => ({ reports: await getMonthlyReports(companyId) }));
}

// { month: "YYYY-MM" } その月のレポートを作る(作り直す)
export async function POST(request: Request) {
  await requireCompanyId();
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    const r = await generateMonthlyReport(user, body.month);
    await audit("AIの月次レポートを作成", `${r.month}(${r.mode === "claude" ? "AI" : "決まった形"})`);
    return { month: r.month, mode: r.mode };
  });
}

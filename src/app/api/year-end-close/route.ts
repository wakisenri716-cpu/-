import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { getYearEndChecklist, getYearEndReview, reviewYearEnd, setYearEndCheck } from "@/lib/yearEndClose";
import { audit } from "@/lib/audit";

export async function GET(request: Request) {
  const companyId = await requireCompanyId();
  const year = new URL(request.url).searchParams.get("year");
  return respond(async () => {
    const c = await getYearEndChecklist(companyId, year);
    return { ...c, review: await getYearEndReview(companyId, c.fiscalYear) };
  });
}

// { action: "check", key, checked, year } 人が確かめた項目 / { action: "review", year } AIにまとめてもらう
export async function POST(request: Request) {
  await requireCompanyId();
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    if (body.action === "check") {
      const c = await setYearEndCheck(user, body.year, String(body.key ?? ""), body.checked === true);
      await audit("決算の準備", `${c.fiscalYear}年度 ${String(body.key)} を${body.checked === true ? "済み" : "未"}にした`);
      return { ...c, review: await getYearEndReview(user.companyId, c.fiscalYear) };
    }
    const note = await reviewYearEnd(user, body.year);
    const c = await getYearEndChecklist(user.companyId, body.year);
    await audit("決算の準備(AI)", `${c.fiscalYear}年度(${note.mode === "claude" ? "AI" : "決まったルール"})`);
    return { ...c, review: note };
  });
}

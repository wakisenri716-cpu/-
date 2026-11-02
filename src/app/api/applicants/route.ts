import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { createApplicant, listApplicants, parseApplicantText, purgeOldApplicants } from "@/lib/applicants";
import { audit } from "@/lib/audit";

export async function GET() {
  const companyId = await requireCompanyId();
  return respond(() => listApplicants(companyId));
}

// { action: "parse", text } で1行を分ける、{ action: "purge" } で古い不採用・辞退を消す、それ以外は記録する
export async function POST(request: Request) {
  await requireCompanyId();
  const user = await requireMember();
  const body = (await request.json().catch(() => ({}))) ?? {};
  if (body.action === "parse") return respond(async () => ({ draft: parseApplicantText(String(body.text ?? "")) }));
  if (body.action === "purge")
    return respond(async () => {
      const count = await purgeOldApplicants(user);
      await audit("古い応募者の情報を消去", `${count}人`);
      return { count };
    });
  return respond(async () => {
    const applicant = await createApplicant(user, body);
    await audit("応募者を記録", `${applicant.name}${applicant.position ? `(${applicant.position})` : ""}`);
    return { applicant };
  }, 201);
}

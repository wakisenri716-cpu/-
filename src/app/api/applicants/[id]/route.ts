import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { draftApplicantMail, sendApplicantMail, updateApplicant, STATUS, type Status } from "@/lib/applicants";
import { audit } from "@/lib/audit";

// 進める・面接の日時: { status, interviewDate, interviewTime, interviewerId, note }
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireCompanyId();
  const user = await requireMember();
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) ?? {};
  return respond(async () => {
    const a = await updateApplicant(user, id, body);
    await audit("応募者を更新", `${a.name} ${STATUS[a.status as Status]}${a.interviewDate ? ` 面接 ${a.interviewDate} ${a.interviewTime ?? ""}` : ""}`);
    return { applicant: a };
  });
}

// メール: { action: "draft", kind, useAi } で下書き、{ action: "send", kind, to, subject, body } で送る
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireCompanyId();
  const user = await requireMember();
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) ?? {};
  if (body.action === "send")
    return respond(async () => {
      const a = await sendApplicantMail(user, id, body);
      await audit("応募者にメールを送信", `${a.name} ${String(body.subject ?? "")}`);
      return { applicant: a };
    });
  return respond(() => draftApplicantMail(user, id, body.kind, body.useAi === true));
}

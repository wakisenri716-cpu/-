import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { draftApplicantMail, draftInterviewQuestions, hireApplicant, sendApplicantMail, updateApplicant, STATUS, type Status } from "@/lib/applicants";
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
  // 面接の質問案: { action: "questions", useAi }
  if (body.action === "questions") return respond(() => draftInterviewQuestions(user, id, body.useAi === true));
  // 入社した: { action: "hire", hireDate, hourlyWage } で労働者名簿に入れる
  if (body.action === "hire")
    return respond(async () => {
      const r = await hireApplicant(user, id, body);
      await audit("応募者を労働者名簿に登録", `${r.staff.name} 入社日 ${String(body.hireDate)}`);
      return r;
    });
  if (body.action === "send")
    return respond(async () => {
      const a = await sendApplicantMail(user, id, body);
      await audit("応募者にメールを送信", `${a.name} ${String(body.subject ?? "")}`);
      return { applicant: a };
    });
  return respond(() => draftApplicantMail(user, id, body.kind, body.useAi === true));
}

import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { sendGreetingMails } from "@/lib/greetingMail";
import { audit } from "@/lib/audit";
import { UserError } from "@/lib/errors";

// 挨拶状をメールでまとめて送る: { subject, body: 段落[], notes: 記[], sender, recipients: 顧客ID[] }
export async function POST(request: Request) {
  await requireCompanyId();
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    if (user.role === "EMPLOYEE" || user.role === "ADVISOR")
      throw new UserError(
        "取引先へのまとめての送信は、管理者・経理担当ができます",
      );
    const result = await sendGreetingMails(user, body ?? {});
    await audit(
      "挨拶状をメールでまとめて送信",
      `${String(body?.subject ?? "").slice(0, 60)} ${result.sent + result.test}社${result.failed.length ? `(失敗${result.failed.length})` : ""}`,
    );
    return result;
  });
}

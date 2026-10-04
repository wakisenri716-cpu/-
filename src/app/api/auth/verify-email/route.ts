import { requireUser } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { sendVerification } from "@/lib/auth/emailVerification";
import { appUrl } from "@/lib/mail";

// 確認のメールをもう一度送る
export async function POST(request: Request) {
  const user = await requireUser();
  return respond(async () => {
    await sendVerification(user.id, appUrl(request));
    return { ok: true, email: user.email };
  });
}

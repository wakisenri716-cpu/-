import { requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { readCertificate } from "@/lib/yearEndForms";
import { UserError } from "@/lib/errors";

// 従業員: 控除証明書の写真をAIで読む(金額は画面で申告に足す。保存はしない)
export async function POST(request: Request) {
  const user = await requireMember();
  const form = await request.formData().catch(() => null);
  return respond(async () => {
    const file = form?.get("file");
    if (!(file instanceof File)) throw new UserError("控除証明書の写真を選んでください");
    return readCertificate(user, file);
  });
}

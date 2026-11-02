import { requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { saveOwnLicense } from "@/lib/staffLicenses";

// 更新した期限などを直す(自分のものだけ)
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireMember();
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) ?? {};
  return respond(async () => ({ license: await saveOwnLicense(user, body, id) }));
}

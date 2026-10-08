import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { buildPrep } from "@/lib/meetingPrep";
import { UserError } from "@/lib/errors";

// 訪問・打ち合わせの準備メモ(何も保存しない)
export async function POST(request: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const { kind, id } = await params;
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    if (kind !== "customer" && kind !== "vendor") throw new UserError("取引先の種類が正しくありません");
    return buildPrep({ id: user.id, companyId }, kind, id, body ?? {});
  });
}

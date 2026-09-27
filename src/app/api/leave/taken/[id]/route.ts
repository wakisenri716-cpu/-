import { requireCompanyId } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { deleteTaken } from "@/lib/leave/service";
import { audit } from "@/lib/audit";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  return respond(async () => {
    const removed = await deleteTaken(companyId, id);
    await audit("有給休暇の取得を削除", `${removed.date.toISOString().slice(0, 10)} ${removed.halfDays / 2}日`);
  });
}

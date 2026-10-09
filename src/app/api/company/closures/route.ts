import { requireCompanyId, requireUser } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { UserError } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { addClosures, listClosures, removeClosures } from "@/lib/companyClosures";

export async function GET() {
  const companyId = await requireCompanyId();
  return respond(async () => ({ closures: await listClosures(companyId) }));
}

// 休業日を入れる: { from, to, name }
export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const user = await requireUser();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    if (user.role !== "ADMIN") throw new UserError("会社の休業日は管理者が決められます");
    const count = await addClosures(companyId, body ?? {});
    await audit("会社の休業日を入れる", `${body?.name ?? ""} ${body?.from ?? ""}〜${body?.to ?? ""}(${count}日)`);
    return { count, closures: await listClosures(companyId) };
  });
}

// 休業日を消す: { dates: [] }
export async function DELETE(request: Request) {
  const companyId = await requireCompanyId();
  const user = await requireUser();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    if (user.role !== "ADMIN") throw new UserError("会社の休業日は管理者が決められます");
    const count = await removeClosures(companyId, body ?? {});
    await audit("会社の休業日を消す", `${count}日`);
    return { count, closures: await listClosures(companyId) };
  });
}

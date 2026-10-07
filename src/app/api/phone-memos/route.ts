import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { createMemo, listMemos } from "@/lib/phoneMemos";
import { audit } from "@/lib/audit";

export async function GET() {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  return respond(async () => ({ memos: await listMemos(companyId, user.id) }));
}

// 伝言を残す(宛先の人にメールでも知らせられる)
export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    const result = await createMemo({ id: user.id, companyId, name: user.name }, body ?? {}, request);
    await audit("伝言メモを残す", `${result.memo.callerCompany ?? ""} ${result.memo.callerName ?? ""} → ${result.memo.forName ?? "どなたか"}`.trim());
    return result;
  });
}

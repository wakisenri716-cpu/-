import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { audit } from "@/lib/audit";
import { transferHandover } from "@/lib/handover";

// 選んだやること・伝言・郵便物・商談を後任の人に移す: { fromUserId, toUserId, taskIds, memoIds, mailIds, dealIds, text, notify }
export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    const r = await transferHandover({ companyId, name: user.name, role: user.role }, body ?? {}, request);
    await audit("引き継ぎ", `${r.from} → ${r.to}(やること${r.tasks}・伝言${r.memos}・郵便物${r.mail}・商談${r.deals})`);
    return r;
  });
}

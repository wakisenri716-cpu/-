import { requireCompanyId } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { forgetLearning } from "@/lib/aiLearning";
import { audit } from "@/lib/audit";

// 覚えたことを忘れる
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const companyId = await requireCompanyId();
  const { id } = await params;
  return respond(async () => {
    const c = await forgetLearning(companyId, id);
    await audit("AIが覚えたことを忘れさせた", `${c.label} → ${c.toCode}`);
    return { ok: true };
  });
}

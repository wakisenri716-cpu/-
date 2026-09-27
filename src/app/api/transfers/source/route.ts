import { requireCompanyId } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { updateTransferSource } from "@/lib/transfers/service";
import { audit } from "@/lib/audit";

// 振込元の口座(委託者コード・依頼人名・口座)
export async function PUT(request: Request) {
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    const source = await updateTransferSource(companyId, body);
    await audit("振込元の口座を変更", `${source.bankName} ${source.branchName}`);
    return source;
  });
}

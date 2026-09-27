import { requireCompanyId } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { setPayeeAccount } from "@/lib/transfers/service";
import { audit } from "@/lib/audit";

// スタッフ・取引先の振込先の口座(account を null にすると消す)
export async function PUT(request: Request) {
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    const kind = body.kind === "vendor" ? "vendor" : "staff";
    const name = await setPayeeAccount(companyId, kind, String(body.id ?? ""), body.account ?? null);
    await audit(body.account ? "振込先の口座を登録" : "振込先の口座を削除", name);
    return { ok: true };
  });
}

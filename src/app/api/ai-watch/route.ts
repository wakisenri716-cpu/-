import { requireCompanyId } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { checkWatchAlerts } from "@/lib/watchAlerts";
import { appUrl } from "@/lib/mail";
import { audit } from "@/lib/audit";

// 今すぐ見張りを確かめ、新しく「要確認」になったものがあれば知らせる
export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  return respond(async () => {
    const r = await checkWatchAlerts(companyId, appUrl(request));
    if (r.fresh.length) await audit("AIの見張りを確かめた", `新しい要確認 ${r.fresh.map((f) => f.label).join("・")}`);
    return r;
  });
}

import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { listContracts, uploadContract } from "@/lib/contracts";
import { audit } from "@/lib/audit";
import { UserError } from "@/lib/errors";

export async function GET() {
  const companyId = await requireCompanyId();
  return respond(async () => listContracts(companyId));
}

// 契約書(PDF・画像)をアップロードして台帳に登録する
export async function POST(request: Request) {
  await requireCompanyId();
  const user = await requireMember();
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  return respond(async () => {
    if (!(file instanceof File)) throw new UserError("ファイルを選んでください");
    const contract = await uploadContract(user, file);
    await audit("契約書を台帳に登録", `${contract.title}${contract.counterparty ? ` / ${contract.counterparty}` : ""}`);
    return { contract };
  });
}

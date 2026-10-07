import { requireCompanyId } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { parseRegisterInput, registerCard } from "@/lib/businessCards";
import { audit } from "@/lib/audit";

// 読み取った名刺を顧客・仕入先に登録する(もう登録されている相手なら空いている項目を埋める)
export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => null);
  return respond(async () => {
    const input = parseRegisterInput(body);
    const result = await registerCard(companyId, input);
    const who = input.kind === "customer" ? "顧客" : "仕入先";
    await audit(result.created ? `名刺から${who}を登録` : `名刺で${who}の情報を追加`, `${result.name}${input.card.name ? ` / ${input.card.name}` : ""}`);
    return result;
  });
}

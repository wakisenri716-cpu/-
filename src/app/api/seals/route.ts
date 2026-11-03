import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { listSeals, parseSeal, requestSeal } from "@/lib/sealUses";
import { audit } from "@/lib/audit";

export async function GET() {
  const companyId = await requireCompanyId();
  return respond(() => listSeals(companyId));
}

// { action: "parse", text } で1行を分ける、それ以外は申請する
export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const body = (await request.json().catch(() => ({}))) ?? {};
  if (body.action === "parse") return respond(async () => ({ draft: await parseSeal(String(body.text ?? "")) }));
  return respond(async () => {
    const row = await requestSeal({ id: user.id, name: user.name, companyId }, body, request);
    await audit("押印を申請", `${row.document} ${row.copies}部`);
    return { seal: row };
  }, 201);
}

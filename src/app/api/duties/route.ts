import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { listDuties, parseDuty, saveDuty } from "@/lib/duties";
import { audit } from "@/lib/audit";

export async function GET() {
  const companyId = await requireCompanyId();
  return respond(() => listDuties(companyId));
}

// { action: "parse", text } で1行を分ける、それ以外は当番を作る
export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const body = (await request.json().catch(() => ({}))) ?? {};
  if (body.action === "parse") return respond(async () => ({ draft: await parseDuty(companyId, String(body.text ?? "")) }));
  return respond(async () => {
    const role = await saveDuty({ id: user.id, name: user.name, companyId, role: user.role }, body);
    await audit("当番を作った", `${role.name}(${role.memberIds.length}人)`);
    return { role };
  }, 201);
}

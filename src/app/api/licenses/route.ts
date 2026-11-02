import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { listLicenses, parseLicense, saveLicense } from "@/lib/staffLicenses";
import { audit } from "@/lib/audit";

export async function GET() {
  const companyId = await requireCompanyId();
  return respond(() => listLicenses(companyId));
}

// { action: "parse", text } で1行を分ける、それ以外は記録する
export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const body = (await request.json().catch(() => ({}))) ?? {};
  if (body.action === "parse") return respond(async () => ({ draft: await parseLicense(companyId, String(body.text ?? "")) }));
  return respond(async () => {
    const license = await saveLicense({ companyId, name: user.name, role: user.role }, body);
    await audit("資格・免許を記録", `${license.holderName} ${license.name}${license.expiresOn ? `(${license.expiresOn}まで)` : ""}`);
    return { license };
  }, 201);
}

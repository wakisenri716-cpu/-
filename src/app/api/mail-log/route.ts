import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { createMailItems, listMailItems } from "@/lib/mailItems";
import { audit } from "@/lib/audit";

export async function GET() {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  return respond(async () => ({ items: await listMailItems(companyId, user.id) }));
}

// 届いた郵便物・荷物をまとめて記録する: { items, receivedOn, notify }
export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    const result = await createMailItems({ id: user.id, companyId, name: user.name }, body ?? {}, request);
    await audit("郵便物・荷物を受け付け", `${result.count}件${result.mailed ? `(メール ${result.mailed}通)` : ""}`);
    return result;
  });
}
